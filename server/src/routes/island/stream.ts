/**
 * The live mission feed, as Server-Sent Events.
 *
 * A mission is a long-running server-side job that a browser wants to watch, so
 * the traffic is entirely one-way and SSE is the smallest thing that works: no
 * socket upgrade, no second protocol, and a client that loses its connection
 * resumes by telling us the last sequence number it saw.
 *
 * Nothing here is a source of truth. Every event is already in `island_events`
 * before the bus hears about it, so a client that misses the stream entirely
 * still gets the whole timeline from `GET /api/island/missions/:id`.
 *
 * Authentication is the ordinary bearer header, which means this endpoint is
 * read with `fetch` and a stream reader rather than with `EventSource` —
 * EventSource cannot set headers, and the alternative is putting a credential
 * in a query string, where it ends up in access logs and browser history.
 */
import type { Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/errors';
import { store } from '../../middleware/auth';
import { parseQuery, pathParam } from '../../middleware/validate';
import { subscribe } from '../../island/events';
import { findMission, getMission, listEvents } from '../../island/store';
import type { MissionEvent, MissionEventType, MissionStatus } from '../../island/types';

/** A whole mission is a few hundred events; this is a safety valve, not a page size. */
const REPLAY_LIMIT = 1_000;
const HEARTBEAT_MS = 25_000;
/** How long a dropped client should wait before reconnecting. */
const RETRY_MS = 3_000;

const TERMINAL_STATUSES: ReadonlySet<MissionStatus> = new Set<MissionStatus>([
  'completed',
  'failed',
  'aborted',
]);

const TERMINAL_EVENTS: ReadonlySet<MissionEventType> = new Set<MissionEventType>([
  'mission_completed',
  'mission_failed',
  'mission_aborted',
]);

const streamQuerySchema = z.object({
  afterSeq: z.coerce.number().int().min(0).max(10_000_000).optional(),
});

/**
 * Where to resume from. `Last-Event-ID` is the protocol's own mechanism and a
 * reconnecting client sends it without being asked, so it wins; `?afterSeq=` is
 * there for a client that is driving the stream itself.
 */
function resumeFrom(req: Request, fallback: number): number {
  const header = req.header('last-event-id');
  if (!header) return fallback;
  const parsed = Number.parseInt(header, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export const streamMission = asyncHandler(async (req: Request, res: Response) => {
  const s = store(req);
  const missionId = pathParam(req, 'id');
  // Load the mission before a single byte goes out. A missing one has to come
  // back as a JSON 404; once flushHeaders() has run the only thing this
  // response can ever be is an event stream.
  const mission = getMission(s, missionId);
  const afterSeq = resumeFrom(req, parseQuery(streamQuerySchema, req).afterSeq ?? 0);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  // nginx buffers a proxied response by default, which turns a live feed into a
  // long silence followed by the entire mission arriving at once.
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  // Every write here is a few hundred bytes and wanted immediately; Nagle would
  // sit on them waiting for company.
  res.socket?.setNoDelay(true);

  let open = true;
  let replaying = true;
  let highWater = afterSeq;
  const queued: MissionEvent[] = [];

  const heartbeat = setInterval(() => {
    // A comment line: it keeps the connection and any proxy idle timer alive
    // without the client having to understand an invented event type.
    if (open) res.write(': keep-alive\n\n');
  }, HEARTBEAT_MS);
  // A pending heartbeat must never be the reason the process will not exit.
  heartbeat.unref();

  function teardown(): void {
    if (!open) return;
    open = false;
    clearInterval(heartbeat);
    unsubscribe();
  }

  function control(name: string, payload: Record<string, unknown>): void {
    if (!open) return;
    res.write(`event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`);
  }

  function finish(reason: string): void {
    if (!open) return;
    control('stream_end', { reason, lastSeq: highWater });
    teardown();
    res.end();
  }

  function send(event: MissionEvent): void {
    // The replay and the live bus overlap on purpose; `seq` is what makes the
    // overlap harmless, and it is the same number a reconnect resumes from.
    if (!open || event.seq <= highWater) return;
    highWater = event.seq;
    res.write(`id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    // Holding the socket open on a mission that will never emit again just
    // costs both ends a file descriptor.
    if (TERMINAL_EVENTS.has(event.type)) finish('mission_finished');
  }

  // Subscribing before the table is read is what closes the gap: an event
  // published while the replay query runs lands in `queued` instead of falling
  // between the two halves and never being delivered at all.
  const unsubscribe = subscribe(missionId, (event) => {
    if (replaying) {
      queued.push(event);
      return;
    }
    send(event);
  });

  req.on('close', teardown);
  // A write to a socket the reader has already dropped surfaces here rather
  // than as a throw. Without this the subscription and the timer would outlive
  // every reconnect, which is a leak that only shows up after a long uptime.
  res.on('error', teardown);

  try {
    const stored = listEvents(s, missionId, afterSeq);
    const truncated = stored.length > REPLAY_LIMIT;
    // If a mission somehow has more history than one connection should carry,
    // the newest events are the ones worth streaming — the complete timeline is
    // always available from the mission detail endpoint, so nothing is lost.
    const replay = truncated ? stored.slice(-REPLAY_LIMIT) : stored;

    res.write(`retry: ${RETRY_MS}\n\n`);
    control('stream_open', {
      missionId: mission.id,
      reference: mission.reference,
      status: mission.status,
      afterSeq,
      replayed: replay.length,
      truncated,
      skipped: stored.length - replay.length,
      firstSeq: replay[0]?.seq ?? afterSeq,
    });

    for (const event of replay) send(event);
    replaying = false;
    for (const event of queued.splice(0)) send(event);

    // A mission that had already finished when the client connected never emits
    // a terminal event, so read the status back and close on it instead.
    const current = findMission(s, missionId);
    if (current && TERMINAL_STATUSES.has(current.status)) finish('mission_finished');
  } catch (error) {
    // The headers are long gone, so the error handler cannot help: say so on
    // the stream, log it here, and let the client reconnect.
    console.error('[island] mission stream failed', error);
    finish('error');
  }
});

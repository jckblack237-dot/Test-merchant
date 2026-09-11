/**
 * The live mission bus.
 *
 * Deliberately tiny and in-process: the orchestrator runs inside the API
 * process, so an SSE connection and the mission it is watching are always in
 * the same Node instance. Nothing here is the source of truth — every event is
 * already in `island_events` before it reaches this module, and a client that
 * reconnects replays from the table. This only saves the last hop the poll
 * would otherwise cost.
 */
import type { MissionEvent } from './types';

export type Listener = (event: MissionEvent) => void;

const listeners = new Map<string, Set<Listener>>();

/** Returns the unsubscribe function. Calling it twice is harmless. */
export function subscribe(missionId: string, listener: Listener): () => void {
  let set = listeners.get(missionId);
  if (!set) {
    set = new Set<Listener>();
    listeners.set(missionId, set);
  }
  set.add(listener);

  return () => {
    const current = listeners.get(missionId);
    if (!current) return;
    current.delete(listener);
    // Missions end; leaving an empty Set behind for every one of them would be
    // a slow leak in a process that stays up for weeks.
    if (current.size === 0) listeners.delete(missionId);
  };
}

export function publish(event: MissionEvent): void {
  const set = listeners.get(event.missionId);
  if (!set || set.size === 0) return;

  // Iterate a copy: a listener is allowed to unsubscribe itself on delivery,
  // which is exactly what an SSE handler does when the client has gone away.
  for (const listener of [...set]) {
    try {
      listener(event);
    } catch (error) {
      // One broken subscriber must not cost the others their event, and must
      // never propagate back into the mission that emitted it.
      console.error('[island] mission event listener threw', error);
    }
  }
}

export function listenerCount(missionId: string): number {
  return listeners.get(missionId)?.size ?? 0;
}

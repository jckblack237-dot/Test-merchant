import { Router, type Request } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/errors';
import { merchantPrincipal, requireRole, store } from '../../middleware/auth';
import { parseBody, parseQuery, pathParam } from '../../middleware/validate';
import { requireActiveSubscription } from '../../middleware/subscription';
import { missionFollowupLimiter, missionLimiter } from '../../middleware/rateLimit';
import { ApiError, conflict, notFound, tooManyRequests } from '../../lib/errors';
import { paginationSchema } from '../../lib/validators';
import { getMerchant } from '../../services/subscriptions';
import type { TenantStore } from '../../db/tenant';
import { islandConfig } from '../../island/config';
import { requireAgent, rosterForMerchant } from '../../island/agents/registry';
import { answerFollowup } from '../../island/followup';
import {
  abortMission, approveStage, isRunning, pauseMission, resumeMission, startMission,
} from '../../island/orchestrator';
import { reportToMarkdown } from '../../island/report';
import {
  addFollowup,
  appendEvent,
  countMissionsToday,
  createMission,
  deleteMission,
  getMission,
  getRun,
  listCorrections,
  listEvents,
  listFollowups,
  listMissions,
  listRuns,
  listSources,
  listVerifications,
} from '../../island/store';
import type { AgentRunRecord, MissionRecord } from '../../island/types';
import { REQUIRED_AGENT_IDS, shapeAgent } from './agents';
import { streamMission } from './stream';

export const missionsRouter = Router();

/** Statuses that mean the orchestrator still has work in hand for this mission.
 *  `created` is not one of them: a mission made with `start: false` has never
 *  been picked up, and there is nothing to interrupt by deleting it. */
const IN_FLIGHT = new Set(['planning', 'running', 'awaiting_approval', 'paused']);

/**
 * The kill switch.
 *
 * `ISLAND_ENABLED=false` is how an operator stops the island spending money
 * without taking the rest of the API down with it, so the refusal has to say
 * that plainly rather than reading like a bug in the island.
 */
function assertIslandEnabled(consequence: string): void {
  if (islandConfig.enabled) return;
  throw new ApiError(
    503,
    'island_disabled',
    `The AI Agent Island is switched off on this server, so ${consequence}. ` +
      'An administrator can turn it back on by setting ISLAND_ENABLED=true.',
  );
}

/** Mission mutations are the island's half of a product sold on its audit log. */
function audit(
  req: Request,
  action: string,
  mission: MissionRecord,
  meta: Record<string, unknown> = {},
): void {
  const principal = merchantPrincipal(req);
  store(req).writeAudit({
    actorType: 'merchant_user', actorId: principal.userId, actorLabel: principal.name,
    action, entityType: 'island_mission', entityId: mission.id, ip: req.ip,
    meta: { reference: mission.reference, ...meta },
  });
}

function shapeMission(mission: MissionRecord) {
  return { ...mission, hasReport: mission.finalReport !== null };
}

/** The list view leaves the final report behind: it is the largest object the
 *  island produces and a list only needs to know that one exists. */
function shapeMissionSummary(mission: MissionRecord) {
  return {
    id: mission.id,
    reference: mission.reference,
    userTask: mission.userTask,
    objective: mission.objective,
    geography: mission.geography,
    currency: mission.currency,
    status: mission.status,
    mode: mission.mode,
    engine: mission.engine,
    enabledAgents: mission.enabledAgents,
    currentStage: mission.currentStage,
    pendingApprovalStage: mission.pendingApprovalStage,
    decision: mission.decision,
    confidence: mission.confidence,
    error: mission.error,
    createdByName: mission.createdByName,
    createdAt: mission.createdAt,
    startedAt: mission.startedAt,
    completedAt: mission.completedAt,
    hasReport: mission.finalReport !== null,
  };
}

/** Everything about a run except the envelope it was given: that envelope
 *  contains the full output of every agent it depends on, so returning it would
 *  send most of the mission back several times over. */
function shapeRun(run: AgentRunRecord) {
  return {
    id: run.id,
    missionId: run.missionId,
    agentId: run.agentId,
    attempt: run.attempt,
    round: run.round,
    status: run.status,
    output: run.output,
    error: run.error,
    confidence: run.confidence,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    durationMs: run.durationMs,
    inputTokens: run.inputTokens,
    outputTokens: run.outputTokens,
    notes: run.notes,
  };
}

/**
 * Which agents this mission will run.
 *
 * An explicit list wins over the merchant's saved roster — a one-off mission
 * often wants a specialist the merchant does not normally pay for — but the
 * three agents the engine cannot be honest without are added back either way,
 * and the result is returned in registry order so the stored list reads like
 * the plan it becomes.
 */
function resolveAgents(s: TenantStore, requested: string[] | undefined): string[] {
  const roster = rosterForMerchant(s);
  const chosen = new Set(
    requested && requested.length > 0
      ? requested.map((id) => requireAgent(id).id)
      : roster.filter((entry) => entry.enabled).map((entry) => entry.definition.id),
  );
  for (const id of REQUIRED_AGENT_IDS) chosen.add(id);
  return roster.filter((entry) => chosen.has(entry.definition.id)).map((entry) => entry.definition.id);
}

/** MerchantRow carries an index signature, so its optional columns arrive untyped. */
function column(row: Record<string, unknown>, key: string, fallback: string): string {
  const value = row[key];
  return typeof value === 'string' && value.trim() ? value : fallback;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

const listSchema = paginationSchema.extend({
  status: z
    .enum(['created', 'planning', 'running', 'awaiting_approval', 'paused', 'completed', 'failed', 'aborted'])
    .optional(),
});

missionsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const s = store(req);
    const params = parseQuery(listSchema, req);
    const { missions, total } = listMissions(s, params);
    res.json({
      missions: missions.map(shapeMissionSummary),
      total,
      limit: params.limit,
      offset: params.offset,
    });
  }),
);

/**
 * One mission and everything it produced.
 *
 * Assembled in a single response because the whole point of the island is that
 * a finding can be followed back to the agent, the source and the challenge it
 * survived — and a UI that has to fetch five endpoints to draw that trail will
 * end up drawing only part of it.
 */
missionsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const s = store(req);
    const mission = getMission(s, pathParam(req, 'id'));
    const selected = new Set(mission.enabledAgents);

    res.json({
      mission: shapeMission(mission),
      runs: listRuns(s, mission.id).map(shapeRun),
      events: listEvents(s, mission.id),
      sources: listSources(s, mission.id),
      verifications: listVerifications(s, mission.id),
      corrections: listCorrections(s, mission.id),
      followups: listFollowups(s, mission.id),
      roster: rosterForMerchant(s).map((entry) => shapeAgent(entry, { selected })),
    });
  }),
);

missionsRouter.get('/:id/stream', streamMission);

/**
 * One agent run, with the exact envelope it was handed.
 *
 * Kept off the mission detail response on purpose: an envelope contains every
 * upstream agent's full output, so including dozens of them would make the page
 * load unreadable. Fetched on demand, it is what turns "the island concluded X"
 * into "this agent concluded X, having been shown exactly this".
 */
missionsRouter.get(
  '/:id/runs/:runId',
  asyncHandler(async (req, res) => {
    const s = store(req);
    const mission = getMission(s, pathParam(req, 'id'));
    const run = getRun(s, mission.id, pathParam(req, 'runId'));
    res.json({ run: { ...shapeRun(run), input: run.input } });
  }),
);


const reportQuerySchema = z.object({ format: z.enum(['json', 'markdown']).default('json') });

missionsRouter.get(
  '/:id/report',
  asyncHandler(async (req, res) => {
    const s = store(req);
    const { format } = parseQuery(reportQuerySchema, req);
    const mission = getMission(s, pathParam(req, 'id'));
    const report = mission.finalReport;
    if (!report) {
      throw notFound(
        mission.status === 'completed'
          ? 'This mission finished without producing a report.'
          : 'This mission has not produced a report yet.',
      );
    }

    if (format === 'markdown') {
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `inline; filename="${mission.reference}.md"`);
      res.send(reportToMarkdown(report));
      return;
    }

    res.json({ report });
  }),
);

// ---------------------------------------------------------------------------
// Starting work
// ---------------------------------------------------------------------------

const createSchema = z.object({
  task: z
    .string()
    .trim()
    .min(12, 'Describe the mission in at least 12 characters so the agents have something to work with.')
    .max(4000, 'Keep the mission brief under 4000 characters.'),
  objective: z.string().trim().max(500).optional(),
  geography: z.string().trim().max(120).optional(),
  language: z.string().trim().max(40).optional(),
  currency: z.string().trim().length(3).toUpperCase().optional(),
  constraints: z.array(z.string().trim().min(1).max(300)).max(20).optional(),
  requirements: z.array(z.string().trim().min(1).max(300)).max(20).optional(),
  agents: z.array(z.string().trim().min(1).max(64)).max(40).optional(),
  mode: z.enum(['auto', 'approval']).default('auto'),
  start: z.boolean().default(true),
});

/**
 * Creates a mission and, unless asked not to, sets it running.
 *
 * Two ceilings apply before anything is written. The address-level limiter is
 * the crude one; the daily count is the one that matters, because a mission is
 * a dozen-odd model calls and the merchant is the party paying for them.
 */
missionsRouter.post(
  '/',
  requireRole('manager'),
  requireActiveSubscription,
  missionLimiter,
  asyncHandler(async (req, res) => {
    const s = store(req);
    const principal = merchantPrincipal(req);
    const input = parseBody(createSchema, req);
    assertIslandEnabled('no mission can be started');

    const today = countMissionsToday(s);
    if (today >= islandConfig.missionsPerDay) {
      throw tooManyRequests(
        `You have started ${today} missions today, which is this island's daily limit of ` +
          `${islandConfig.missionsPerDay}. Every mission is real model time, so the count resets ` +
          'at midnight UTC.',
      );
    }

    // A mission about this merchant's business should default to this
    // merchant's market and money, not to an American one.
    const merchant = getMerchant(s.merchantId);
    const enabledAgents = resolveAgents(s, input.agents);

    const mission = createMission(s, {
      userTask: input.task,
      objective: input.objective ?? '',
      geography: input.geography ?? column(merchant, 'country', ''),
      language: input.language ?? 'English',
      currency: input.currency ?? column(merchant, 'currency', 'USD'),
      constraints: input.constraints ?? [],
      userRequirements: input.requirements ?? [],
      mode: input.mode,
      enabledAgents,
      createdBy: principal.userId,
      createdByName: principal.name,
    });

    appendEvent(s, mission.id, {
      type: 'mission_created',
      message: `${principal.name} created ${mission.reference}.`,
      payload: { mode: mission.mode, engine: mission.engine, agents: enabledAgents },
    });
    audit(req, 'island.mission_created', mission, {
      mode: mission.mode,
      engine: mission.engine,
      agents: enabledAgents.length,
    });

    if (input.start) {
      startMission({ store: s, missionId: mission.id });
      audit(req, 'island.mission_started', mission, { engine: mission.engine });
    }

    // Re-read: startMission may already have moved the mission on, and a client
    // that renders the response should not be shown a status that has passed.
    res.status(201).json({ mission: shapeMission(getMission(s, mission.id)) });
  }),
);

missionsRouter.post(
  '/:id/pause',
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    const mission = pauseMission(store(req), pathParam(req, 'id'));
    audit(req, 'island.mission_paused', mission, { stage: mission.currentStage });
    res.json({ mission: shapeMission(mission) });
  }),
);

missionsRouter.post(
  '/:id/resume',
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    assertIslandEnabled('this mission cannot be resumed');
    const mission = resumeMission(store(req), pathParam(req, 'id'));
    audit(req, 'island.mission_resumed', mission, { stage: mission.currentStage });
    res.json({ mission: shapeMission(mission) });
  }),
);

missionsRouter.post(
  '/:id/abort',
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    const mission = abortMission(store(req), pathParam(req, 'id'));
    audit(req, 'island.mission_aborted', mission, { stage: mission.currentStage });
    res.json({ mission: shapeMission(mission) });
  }),
);

const approveSchema = z.object({ note: z.string().trim().max(500).optional() });

/** Releases an approval-mode gate. The note is kept because "why was this
 *  waved through?" is exactly the question an audit log exists to answer. */
missionsRouter.post(
  '/:id/approve',
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    const s = store(req);
    const { note } = parseBody(approveSchema, req);
    assertIslandEnabled('this stage cannot be approved');

    const waiting = getMission(s, pathParam(req, 'id'));
    const mission = approveStage(s, waiting.id, note);
    audit(req, 'island.mission_approved', mission, {
      stage: waiting.pendingApprovalStage,
      note: note ?? '',
    });
    res.json({ mission: shapeMission(mission) });
  }),
);

// ---------------------------------------------------------------------------
// Afterwards
// ---------------------------------------------------------------------------

const followupSchema = z.object({
  question: z
    .string()
    .trim()
    .min(5, 'Ask a question of at least 5 characters.')
    .max(1000, 'Keep the question under 1000 characters.'),
});

/**
 * Asks a question about a finished mission.
 *
 * The answer is drawn from the mission package alone — that is the whole point,
 * and `answerFollowup` refuses to go beyond it — but it is still a model call,
 * so it is rate limited and written to the mission's own record.
 */
missionsRouter.post(
  '/:id/followups',
  missionFollowupLimiter,
  asyncHandler(async (req, res) => {
    const s = store(req);
    const principal = merchantPrincipal(req);
    const { question } = parseBody(followupSchema, req);
    const mission = getMission(s, pathParam(req, 'id'));
    assertIslandEnabled('follow-up questions cannot be answered');

    const answer = await answerFollowup(s, mission, question);
    const followup = addFollowup(s, mission.id, question, answer, principal.userId);
    audit(req, 'island.followup_asked', mission, { followupId: followup.id });

    res.status(201).json({ answer, followup });
  }),
);

/**
 * Deletes a mission and everything under it.
 *
 * Owner-only, and never while the orchestrator still holds it: the engine keeps
 * writing runs and events for a mission in flight, and pulling the row out from
 * under it would turn an honest failure into a confusing one.
 */
missionsRouter.delete(
  '/:id',
  requireRole('owner'),
  asyncHandler(async (req, res) => {
    const s = store(req);
    const mission = getMission(s, pathParam(req, 'id'));
    if (isRunning(mission.id) || IN_FLIGHT.has(mission.status)) {
      throw conflict('This mission is still in progress. Abort it first, then delete it.');
    }

    deleteMission(s, mission.id);
    audit(req, 'island.mission_deleted', mission, { status: mission.status });
    res.status(204).end();
  }),
);

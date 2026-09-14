/**
 * The engine behind the hosted island.
 *
 * This is `server/src/island/orchestrator.ts` and `validate.ts` ported to the
 * browser, close enough that the repo stays the specification: the Task
 * Manager runs first and narrows the roster, the rest run in topological waves
 * with at most three model calls in flight, every agent gets the full output of
 * what it depends on and a trimmed hand-off from everyone else, every response
 * is validated against that agent's schema, a challenge between two agents is
 * recorded with the claim it disputes, the verification gate genuinely sends
 * flagged findings back for a correction round, and a confidence may fall but
 * may never rise.
 *
 * Two things are different here, and both follow from where this version runs.
 *
 * THERE IS NO RETRIEVAL. A published artifact cannot reach the open web — the
 * CSP blocks every host, this account has no connectors, and `sample` hands the
 * page a Claude with no web_search tool. So no agent on this island looked
 * anything up; every claim is the model reasoning from training data, which is
 * exactly the fabrication risk the product exists to catch. Keeping that fact
 * visible in the output, rather than letting it hide behind a VERIFIED label, a
 * confidence of 0.9 and a URL, is the job of `enforceNoRetrievalHonesty`. Read
 * that function before changing anything near it.
 *
 * The surface is `window.IslandEngine`: `createMission`, `startMission`,
 * `pauseMission`, `resumeMission`, `approveStage`, `abortMission`,
 * `listMissions`, `loadMission`, `deleteMission`, `isAvailable` and `onEvent`.
 * `startMission` takes either a mission id (and per-mission handlers) or the
 * page's own form object, which it creates and starts in one call.
 *
 * AND A MISSION LIVES IN ONE TAB. The loop is this page's; a reload ends it.
 * Everything is written to `db` as it happens so the work survives, and a
 * mission whose heartbeat has gone quiet is marked failed rather than left
 * animating on screen with nothing behind it — the same lie the repo's loop is
 * shaped to avoid, in the one form this version can suffer from.
 */
window.IslandEngine = (function () {
  'use strict';

  const STAGE_ORDER = ['plan', 'gather', 'analyse', 'verify', 'quantify', 'strategise', 'review'];

  const STAGE_LABEL = {
    plan: 'Planning',
    gather: 'Gathering',
    analyse: 'Analysis',
    verify: 'Verification',
    quantify: 'Financial',
    strategise: 'Strategy',
    review: 'Chief review',
  };

  /** Dropped from the plan's narrowing however the Task Manager writes it: the
   *  gate and the final review are what make the rest of the mission trustworthy. */
  const ALWAYS_KEEP = new Set(['risk_verification', 'chief_ai']);

  const TERMINAL = new Set(['completed', 'failed', 'aborted']);
  const SEVERITIES = new Set(['low', 'medium', 'high']);
  const LABELS = new Set(['VERIFIED', 'ESTIMATE', 'NEEDS_VERIFICATION', 'HIGH_RISK']);
  const DECISIONS = new Set(['proceed', 'proceed_with_caution', 'more_research', 'do_not_proceed']);

  const CONFIG = {
    /** Nothing was retrieved, so nothing on this island may claim more (§ honesty). */
    confidenceCeiling: 0.6,
    /** Schema-repair round trips before an agent is declared failed. */
    maxRepairs: 2,
    maxCorrectionRounds: 3,
    maxConcurrentAgents: 3,
    /** `sample` takes 64 KiB of input; this leaves room for the reply framing. */
    maxPromptBytes: 60000,
    /** Kept back from the first prompt so a repair round still fits in 64 KiB. */
    repairReserveBytes: 14000,
    eventFlushMs: 1200,
    /** A mission's events live in one document, so the tail is what is kept. */
    maxStoredEvents: 600,
    /** Past this with no heartbeat, nothing is running the mission any more. */
    staleHeartbeatMs: 180000,
    rateLimitBackoffMs: 8000,
  };

  const NO_RETRIEVAL_NOTICE =
    'No agent on this mission retrieved anything. This page has no web access, no search tool and no ' +
    'connected data, so every figure, name and claim below is a model reasoning from what it was ' +
    'trained on. Treat all of it as a starting point to check, never as a finding.';

  /** Sample error codes that mean this view will never reach Claude again. */
  const SAMPLE_GONE = new Set([
    'not_granted',
    'sampling_disabled',
    'not_declared',
    'capability_disabled',
    'capability_removed',
    'session_expired',
  ]);

  // ---------------------------------------------------------------------------
  // Reading model output: everything off the core envelope arrives as unknown
  // ---------------------------------------------------------------------------

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function asRecord(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    return {};
  }

  function asText(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function asNumber(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  }

  function clamp01(value) {
    return Math.min(1, Math.max(0, value));
  }

  function asLevel(value, fallback) {
    const text = asText(value);
    return SEVERITIES.has(text) ? text : fallback || 'medium';
  }

  function textList(value) {
    return asArray(value).map(asText).filter(Boolean);
  }

  function plural(count, noun) {
    return count + ' ' + noun + (count === 1 ? '' : 's');
  }

  function percent(value) {
    return Math.round(clamp01(value) * 100) + '%';
  }

  function sentence(value) {
    return /[.!?]$/.test(value) ? value : value + '.';
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function newId(prefix) {
    return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function clone(value) {
    return value === undefined ? value : JSON.parse(JSON.stringify(value));
  }

  function byteLength(text) {
    return new TextEncoder().encode(text).length;
  }

  function clip(text, limit) {
    if (text.length <= limit) return text;
    return text.slice(0, limit) + '\n… truncated here: it was too large to pass on in full.';
  }

  function unique(values, limit) {
    const seen = new Set();
    const out = [];
    for (const value of values) {
      const key = value.toLowerCase();
      if (!value || seen.has(key)) continue;
      seen.add(key);
      out.push(value);
      if (out.length >= (limit || 60)) break;
    }
    return out;
  }

  function delay(ms, signal) {
    return new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', finish);
        resolve();
      };
      const timer = setTimeout(finish, ms);
      if (signal) signal.addEventListener('abort', finish, { once: true });
    });
  }

  /** Best-effort "these two citations are the same page" key, as the repo has it. */
  function urlKey(url) {
    return String(url || '')
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/[/?#]+$/, '');
  }

  function claimKey(claim) {
    return String(claim || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[.!?]+$/, '');
  }

  function evidenceKey(evidence) {
    const url = urlKey(asRecord(evidence).source_url);
    if (url) return 'url:' + url;
    const id = asText(asRecord(evidence).source_id).toLowerCase();
    return id ? 'ref:' + id : '';
  }

  /** Unwinds the mission loop. Not a failure — the user asked for it. */
  function missionAborted() {
    const error = new Error('Mission aborted.');
    error.name = 'MissionAborted';
    error.aborted = true;
    return error;
  }

  /** An agent that could not produce schema-valid output. */
  function agentFailure(agentId, message, issues) {
    const error = new Error(message);
    error.name = 'AgentFailure';
    error.agentId = agentId;
    error.issues = issues || [];
    return error;
  }

  /** Claude is gone for this view, so no later agent can run either. */
  function fatalSampleError(message, code) {
    const error = new Error(message);
    error.name = 'SampleUnavailable';
    error.fatal = true;
    error.code = code;
    return error;
  }

  // ---------------------------------------------------------------------------
  // The schema checker, ported from server/src/island/validate.ts
  //
  // Not a library, for the reason the repo gives: the orchestrator does not need
  // a yes or no, it needs to tell a model precisely what was wrong so the model
  // can repair its own answer. A checker over our own small dialect writes
  // better repair instructions than a generic error dump.
  // ---------------------------------------------------------------------------

  function typeOf(value) {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
  }

  function joinPath(path, key) {
    if (typeof key === 'number') return path + '[' + key + ']';
    return path ? path + '.' + key : key;
  }

  /**
   * Removes properties the schema does not declare, recursively.
   *
   * A model adding a helpful extra key is noise, not a contract breach worth a
   * retry. Dropping it keeps the stored output clean while the checks that
   * matter still fail loudly.
   */
  function stripUnknown(value, schema) {
    if (schema.type === 'object' && schema.properties && value && typeof value === 'object' && !Array.isArray(value)) {
      const out = {};
      for (const key of Object.keys(schema.properties)) {
        if (key in value) out[key] = stripUnknown(value[key], schema.properties[key]);
      }
      return out;
    }
    if (schema.type === 'array' && schema.items && Array.isArray(value)) {
      return value.map((item) => stripUnknown(item, schema.items));
    }
    return value;
  }

  function check(value, schema, path, issues) {
    const actual = typeOf(value);

    if (schema.type === 'object') {
      if (actual !== 'object') {
        issues.push({ path: path, message: 'expected an object, received ' + actual });
        return;
      }
      for (const key of schema.required || []) {
        if (!(key in value) || value[key] === undefined) {
          issues.push({ path: joinPath(path, key), message: 'required field is missing' });
        }
      }
      for (const key of Object.keys(schema.properties || {})) {
        if (key in value && value[key] !== undefined) {
          check(value[key], schema.properties[key], joinPath(path, key), issues);
        }
      }
      return;
    }

    if (schema.type === 'array') {
      if (actual !== 'array') {
        issues.push({ path: path, message: 'expected an array, received ' + actual });
        return;
      }
      if (schema.minItems !== undefined && value.length < schema.minItems) {
        issues.push({
          path: path,
          message: 'expected at least ' + schema.minItems + ' item(s), received ' + value.length,
        });
      }
      if (schema.maxItems !== undefined && value.length > schema.maxItems) {
        issues.push({
          path: path,
          message: 'expected at most ' + schema.maxItems + ' item(s), received ' + value.length,
        });
      }
      if (schema.items) {
        value.forEach((item, index) => check(item, schema.items, joinPath(path, index), issues));
      }
      return;
    }

    if (schema.type === 'string') {
      if (actual !== 'string') {
        issues.push({ path: path, message: 'expected a string, received ' + actual });
        return;
      }
      if (schema.enum && !schema.enum.includes(value)) {
        issues.push({
          path: path,
          message: 'must be one of: ' + schema.enum.join(', ') + ' (received "' + value + '")',
        });
      }
      return;
    }

    if (schema.type === 'number' || schema.type === 'integer') {
      if (actual !== 'number' || Number.isNaN(value)) {
        issues.push({ path: path, message: 'expected a number, received ' + actual });
        return;
      }
      if (schema.type === 'integer' && !Number.isInteger(value)) {
        issues.push({ path: path, message: 'expected a whole number, received ' + value });
      }
      if (schema.minimum !== undefined && value < schema.minimum) {
        issues.push({ path: path, message: 'must be at least ' + schema.minimum + ' (received ' + value + ')' });
      }
      if (schema.maximum !== undefined && value > schema.maximum) {
        issues.push({ path: path, message: 'must be at most ' + schema.maximum + ' (received ' + value + ')' });
      }
      return;
    }

    if (schema.type === 'boolean' && actual !== 'boolean') {
      issues.push({ path: path, message: 'expected true or false, received ' + actual });
    }
  }

  /** Every way the value fails the schema. Empty array means it is valid. */
  function validate(value, schema) {
    const issues = [];
    check(value, schema, '', issues);
    return issues;
  }

  /** A repair instruction a model can act on, one line per problem. */
  function describeIssues(issues, limit) {
    return issues
      .slice(0, limit || 25)
      .map((issue) => '- ' + (issue.path || '(root)') + ': ' + issue.message)
      .join('\n');
  }

  /**
   * Best-effort coercion of the shapes models most commonly get slightly wrong,
   * applied before validation so a trivially fixable answer does not cost a
   * round trip. Nothing here invents content: it only re-types what is already
   * there (a number written as "0.8", a single string where a list was asked
   * for, a confidence given as 85 instead of 0.85).
   */
  function coerce(value, schema) {
    if (schema.type === 'object' && schema.properties) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
      const out = Object.assign({}, value);
      for (const key of Object.keys(schema.properties)) {
        if (key in value) out[key] = coerce(value[key], schema.properties[key]);
      }
      return out;
    }

    if (schema.type === 'array') {
      // A model that had exactly one thing to say sometimes returns it bare.
      const list = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
      return schema.items ? list.map((item) => coerce(item, schema.items)) : list;
    }

    if (schema.type === 'number' || schema.type === 'integer') {
      const raw = typeof value === 'string' ? Number(value.replace(/[,\s]/g, '')) : value;
      if (typeof raw !== 'number' || Number.isNaN(raw)) return value;
      let numeric = raw;
      // Confidence expressed as a percentage: 85 means 0.85, not "out of range".
      if (schema.maximum === 1 && schema.minimum === 0 && numeric > 1 && numeric <= 100) numeric = numeric / 100;
      if (schema.type === 'integer') numeric = Math.round(numeric);
      return numeric;
    }

    if (schema.type === 'string' && typeof value === 'number') return String(value);

    if (schema.type === 'boolean' && typeof value === 'string') {
      const lowered = value.trim().toLowerCase();
      if (lowered === 'true') return true;
      if (lowered === 'false') return false;
    }

    return value;
  }

  /** coerce → strip → validate, the order the orchestrator always uses. */
  function normaliseAndValidate(value, schema) {
    const coerced = coerce(value, schema);
    const stripped = stripUnknown(coerced, schema);
    return { value: stripped, issues: validate(stripped, schema) };
  }

  // ---------------------------------------------------------------------------
  // The roster, read from the frozen agents.js
  // ---------------------------------------------------------------------------

  const AGENTS = Array.isArray(window.ISLAND_AGENTS) ? window.ISLAND_AGENTS : [];
  const BY_ID = new Map(AGENTS.map((agent) => [agent.id, agent]));

  function getAgent(id) {
    return BY_ID.get(id);
  }

  function requireAgent(id) {
    const agent = BY_ID.get(id);
    if (!agent) throw new Error('Unknown island agent "' + id + '".');
    return agent;
  }

  /** An agent id is a storage key. Event messages are read by people, so every
   *  one that names an agent says the name the rest of the page shows. */
  function agentName(agentId) {
    const agent = getAgent(agentId);
    return agent ? agent.name : agentId;
  }

  /** Topological waves over the enabled set, exactly as the repo's registry
   *  plans them: everything whose dependencies are already done runs together. */
  function planWaves(enabledIds) {
    const wanted = new Set(enabledIds);
    const deps = new Map();
    let remaining = AGENTS.filter((agent) => wanted.has(agent.id)).map((agent) => {
      deps.set(agent.id, agent.dependsOn.filter((dependency) => wanted.has(dependency)));
      return agent.id;
    });

    const done = new Set();
    const waves = [];
    while (remaining.length > 0) {
      const wave = remaining.filter((id) => (deps.get(id) || []).every((dependency) => done.has(dependency)));
      if (wave.length === 0) {
        throw new Error(
          'Island agent dependency cycle: none of [' + remaining.join(', ') + '] can ever start because ' +
            'each is waiting on another.',
        );
      }
      for (const id of wave) done.add(id);
      waves.push(wave);
      remaining = remaining.filter((id) => !done.has(id));
    }
    return waves;
  }

  /**
   * The correction schema, ported from schemas.ts.
   *
   * The finding and source shapes are lifted from the agent's own schema rather
   * than retyped, so a correction is judged by exactly the contract the first
   * answer was judged by.
   */
  function correctionSchema(definition) {
    const properties = definition.schema.properties || {};
    const findingShape = properties.findings && properties.findings.items;
    const sourceShape = properties.sources && properties.sources.items;

    const shape = {
      mission_id: { type: 'string', description: 'Echo the mission_id unchanged.' },
      agent: { type: 'string', description: 'Always the literal string "' + definition.id + '".' },
      status: {
        type: 'string',
        description: 'Use "failed" only if the issue genuinely cannot be addressed.',
        enum: ['corrected', 'failed'],
      },
      corrections: {
        type: 'array',
        description: 'One entry per issue you were asked to fix.',
        maxItems: 20,
        items: {
          type: 'object',
          properties: {
            finding_id: { type: 'string', description: 'The finding you are correcting.' },
            previous_claim: { type: 'string', description: 'What it said before.' },
            corrected_claim: {
              type: 'string',
              description: 'What it says now. If nothing changed, repeat it and explain why in the reason.',
            },
            reason_for_change: { type: 'string', description: 'Why it changed, or why it stands.' },
            new_sources: {
              type: 'array',
              description: 'Leave empty: nothing can be retrieved on this island.',
              maxItems: 10,
              items: { type: 'string' },
            },
            resolved: {
              type: 'boolean',
              description: 'False if you could not resolve it — say so rather than pretend.',
            },
          },
          required: [
            'finding_id',
            'previous_claim',
            'corrected_claim',
            'reason_for_change',
            'new_sources',
            'resolved',
          ],
          additionalProperties: false,
        },
      },
      findings: {
        type: 'array',
        description: 'Any new or replacement findings.',
        maxItems: 20,
        items: findingShape || { type: 'object', properties: {}, required: [], additionalProperties: false },
      },
      remaining_uncertainties: {
        type: 'array',
        description: 'What is still not settled.',
        maxItems: 25,
        items: { type: 'string' },
      },
      confidence: {
        type: 'number',
        description: 'Your confidence after the correction. It may fall; it cannot rise.',
        minimum: 0,
        maximum: 1,
      },
    };

    if (sourceShape) {
      shape.sources = {
        type: 'array',
        description: 'Leave empty: nothing can be retrieved on this island.',
        maxItems: 20,
        items: sourceShape,
      };
    }

    return {
      type: 'object',
      properties: shape,
      required: Object.keys(shape),
      additionalProperties: false,
    };
  }

  // ---------------------------------------------------------------------------
  // Capabilities: both may resolve null, and neither absence may blank the page
  // ---------------------------------------------------------------------------

  let samplePromise = null;
  let dbPromise = null;
  /** Set when Claude has told us this view will never reach it again. */
  let sampleGone = '';

  function useCapability(name) {
    if (!window.claude || typeof window.claude.use !== 'function') return Promise.resolve(null);
    return window.claude.use(name).catch(() => null);
  }

  function useSample() {
    if (!samplePromise) samplePromise = useCapability('sample');
    return samplePromise;
  }

  function useDb() {
    if (!dbPromise) dbPromise = useCapability('db');
    return dbPromise;
  }

  async function isAvailable() {
    const [sample, db] = await Promise.all([useSample(), useDb()]);
    return { sample: Boolean(sample) && !sampleGone, db: Boolean(db) };
  }

  // ---------------------------------------------------------------------------
  // Persistence
  //
  // Missions, their runs and their timeline go to `db` as they happen, so a
  // reload finds the work and another tab can read it. Memory mirrors every
  // write, which is both the read cache and the whole story when `db` resolved
  // null — in that case the session keeps its missions and the UI says they
  // will not survive the tab.
  //
  // Shapes are chosen around two hard limits in the db contract: a document is
  // at most 256 KiB, and an artifact holds at most 5,000 of them. So the
  // timeline is one document holding the tail of the events rather than a
  // document per event, and a run stores a trimmed envelope rather than the
  // full text of everything its agent was given.
  // ---------------------------------------------------------------------------

  const memory = {
    missions: new Map(),
    runs: new Map(),
    events: new Map(),
    reports: new Map(),
    audit: new Map(),
  };

  let writeChain = Promise.resolve();
  let persistenceWarned = false;
  /** Missions the user deleted. A loop unwinding after the delete would
   *  otherwise write its last events back and resurrect the mission. */
  const discarded = new Set();

  /** A document in the store takes 256 KiB; this leaves room for the framing. */
  const MAX_DOC_BYTES = 200000;

  function fits(doc) {
    return byteLength(JSON.stringify(doc)) <= MAX_DOC_BYTES;
  }

  /** One queue for every write, so a burst of events cannot pile concurrent
   *  writes onto the store and earn a `resource_exhausted`. */
  function enqueueWrite(task) {
    writeChain = writeChain.then(task).catch((error) => {
      if (!persistenceWarned) {
        persistenceWarned = true;
        console.warn('[island] a write to db failed; the mission is still running in this tab', error);
      }
    });
    return writeChain;
  }

  function missionDoc(mission) {
    const doc = Object.assign({}, mission);
    // The report is big and is read only when a mission is opened, so it lives
    // in a document of its own rather than making every list read carry it.
    delete doc.finalReport;
    doc.hasReport = Boolean(mission.finalReport);
    doc.heartbeatAt = mission.heartbeatAt || nowIso();
    return doc;
  }

  function saveMission(mission) {
    if (discarded.has(mission.id)) return Promise.resolve();
    memory.missions.set(mission.id, clone(mission));
    return enqueueWrite(async () => {
      const db = await useDb();
      if (!db) return;
      await db.doc('missions/' + mission.id).set(missionDoc(mission));
    });
  }

  function saveReport(missionId, report) {
    if (discarded.has(missionId)) return Promise.resolve();
    memory.reports.set(missionId, clone(report));
    return enqueueWrite(async () => {
      const db = await useDb();
      if (!db) return;
      let stored = report;
      if (!fits({ report: stored })) {
        // The audit trail is the first thing to go: it is also on the runs.
        stored = Object.assign({}, report, { corrections: [], assumptions: report.assumptions.slice(0, 10) });
      }
      await db.doc('missions/' + missionId + '/parts/report').set({ report: stored });
    });
  }

  function saveRun(run) {
    if (discarded.has(run.missionId)) return Promise.resolve();
    const runs = memory.runs.get(run.missionId) || [];
    const index = runs.findIndex((entry) => entry.id === run.id);
    if (index >= 0) runs[index] = clone(run);
    else runs.push(clone(run));
    memory.runs.set(run.missionId, runs);
    return enqueueWrite(async () => {
      const db = await useDb();
      if (!db) return;
      let doc = run;
      if (!fits(doc)) {
        // Too big for one document. The row still says what happened rather
        // than disappearing, and says what it could not keep.
        doc = Object.assign({}, run, {
          output: null,
          notes:
            'This agent’s output was too large to store (' + byteLength(JSON.stringify(run.output || {})) +
            ' bytes). The run is kept; the output is not.',
        });
      }
      await db.doc('missions/' + run.missionId + '/runs/' + run.id).set(doc);
    });
  }

  function saveEvents(missionId, events, heartbeatAt) {
    if (discarded.has(missionId)) return Promise.resolve();
    memory.events.set(missionId, clone(events));
    return enqueueWrite(async () => {
      const db = await useDb();
      if (!db) return;
      // The timeline is one document, so when it stops fitting the oldest
      // entries go rather than the write failing and losing all of them.
      let kept = events;
      while (kept.length > 1 && !fits({ events: kept })) kept = kept.slice(Math.ceil(kept.length / 10));
      await db.doc('missions/' + missionId + '/parts/events').set({ events: kept });
      // The heartbeat rides along with the timeline write: it is the cheapest
      // proof that a loop is still behind this mission.
      if (heartbeatAt) {
        await db.doc('missions/' + missionId).update({ heartbeatAt: heartbeatAt }).catch(() => {});
      }
    });
  }

  function saveAudit(missionId, audit) {
    if (discarded.has(missionId)) return Promise.resolve();
    memory.audit.set(missionId, clone(audit));
    return enqueueWrite(async () => {
      const db = await useDb();
      if (!db) return;
      await db.doc('missions/' + missionId + '/parts/audit').set(audit);
    });
  }

  /**
   * A paused or half-finished mission does not survive the tab that was running
   * it. Saying so and failing it is the only honest answer; leaving it looking
   * alive would mean it never finished at all.
   */
  function strandedMission(mission) {
    const reason =
      'Nothing is running this mission any more — the tab that was running it was closed or reloaded. ' +
      'It has been marked failed; start a new mission to pick the work up again.';
    const updated = Object.assign({}, mission, {
      status: 'failed',
      error: reason,
      currentStage: null,
      pendingApprovalStage: null,
      completedAt: mission.completedAt || nowIso(),
    });
    saveMission(updated);
    return updated;
  }

  /** Statuses that only exist while a loop is behind them. A mission sitting at
   *  `created` is not stranded — it is waiting for the user to start it. */
  const NEEDS_A_LOOP = new Set(['planning', 'running', 'paused', 'awaiting_approval']);

  function reconcile(mission) {
    if (!mission) return mission;
    if (!NEEDS_A_LOOP.has(mission.status)) return mission;
    if (active.has(mission.id)) return mission;
    const beat = Date.parse(mission.heartbeatAt || mission.startedAt || mission.createdAt || '');
    if (Number.isFinite(beat) && Date.now() - beat < CONFIG.staleHeartbeatMs) return mission;
    return strandedMission(mission);
  }

  async function listMissions() {
    await writeChain;
    const db = await useDb();
    if (db) {
      try {
        const snapshot = await db.collection('missions').orderBy('createdAt', 'desc').limit(50).get();
        const missions = snapshot.docs.map((entry) => Object.assign({ finalReport: null }, entry.data()));
        for (const mission of missions) memory.missions.set(mission.id, clone(mission));
        return missions.map(reconcile);
      } catch (error) {
        console.warn('[island] could not list missions from db; showing this session only', error);
      }
    }
    return Array.from(memory.missions.values())
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .map(reconcile);
  }

  async function loadMission(id) {
    await writeChain;
    const live = active.get(id);
    if (live) {
      // A mission this tab is running is authoritative in memory: the store is
      // always a step behind the loop.
      return {
        mission: clone(live.ctx.mission),
        runs: clone(live.ctx.runs),
        events: clone(live.ctx.events),
        corrections: clone(live.ctx.corrections),
        verifications: clone(live.ctx.verifications),
      };
    }

    const db = await useDb();
    if (db) {
      try {
        const [missionSnap, reportSnap, eventsSnap, auditSnap, runsSnap] = await Promise.all([
          db.doc('missions/' + id).get(),
          db.doc('missions/' + id + '/parts/report').get(),
          db.doc('missions/' + id + '/parts/events').get(),
          db.doc('missions/' + id + '/parts/audit').get(),
          db.collection('missions/' + id + '/runs').get(),
        ]);
        if (missionSnap.exists) {
          const mission = Object.assign({}, missionSnap.data());
          mission.finalReport = reportSnap.exists ? asRecord(reportSnap.data()).report || null : null;
          const runs = runsSnap.docs
            .map((entry) => entry.data())
            .sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
          const events = eventsSnap.exists ? asArray(asRecord(eventsSnap.data()).events) : [];
          const audit = auditSnap.exists ? asRecord(auditSnap.data()) : {};
          memory.missions.set(id, clone(mission));
          memory.runs.set(id, clone(runs));
          memory.events.set(id, clone(events));
          memory.audit.set(id, clone(audit));
          return {
            mission: reconcile(mission),
            runs: runs,
            events: events,
            corrections: asArray(audit.corrections),
            verifications: asArray(audit.verifications),
          };
        }
      } catch (error) {
        console.warn('[island] could not read this mission from db; falling back to memory', error);
      }
    }

    const mission = memory.missions.get(id);
    if (!mission) return null;
    const withReport = Object.assign({}, mission, { finalReport: memory.reports.get(id) || null });
    const audit = memory.audit.get(id) || {};
    return {
      mission: reconcile(withReport),
      runs: clone(memory.runs.get(id) || []),
      events: clone(memory.events.get(id) || []),
      corrections: clone(asArray(audit.corrections)),
      verifications: clone(asArray(audit.verifications)),
    };
  }

  async function deleteMission(id) {
    // Flagged first, so anything the loop writes on its way out is dropped
    // rather than racing the delete and putting the mission back.
    discarded.add(id);
    const live = active.get(id);
    if (live) {
      await abortMission(id).catch(() => {});
      await live.done.catch(() => {});
    }

    memory.missions.delete(id);
    memory.runs.delete(id);
    memory.events.delete(id);
    memory.reports.delete(id);
    memory.audit.delete(id);

    await enqueueWrite(async () => {
      const db = await useDb();
      if (!db) return;
      // Deleting a document does not delete what is nested under it, so the
      // runs go one by one or they stay behind for ever.
      const runs = await db.collection('missions/' + id + '/runs').get();
      for (const entry of runs.docs) await db.doc('missions/' + id + '/runs/' + entry.id).delete();
      await db.doc('missions/' + id + '/parts/report').delete();
      await db.doc('missions/' + id + '/parts/events').delete();
      await db.doc('missions/' + id + '/parts/audit').delete();
      await db.doc('missions/' + id).delete();
    });
  }

  /** "MISSION-2026-001", counted over whatever missions the store can see. */
  async function nextReference() {
    const year = new Date().getUTCFullYear();
    const prefix = 'MISSION-' + year + '-';
    const missions = await listMissions();
    const taken = new Set(missions.map((mission) => mission.reference));
    let sequence = missions.filter((mission) => String(mission.reference).startsWith(prefix)).length + 1;
    while (taken.has(prefix + String(sequence).padStart(3, '0'))) sequence += 1;
    return prefix + String(sequence).padStart(3, '0');
  }

  // ---------------------------------------------------------------------------
  // What the model is actually told
  // ---------------------------------------------------------------------------

  /** The house rules, appended to every agent's own prompt. Ported from
   *  provider/envelope.ts, with the submit tool removed: there is none here. */
  const HOUSE_RULES = [
    '## How every agent on this island must answer',
    '',
    'You are one agent in a pipeline. Agents ran before you, agents will run after you, and one of',
    'them is paid to find the holes in your work. Write for that reader.',
    '',
    'Label every claim honestly:',
    '- ESTIMATE — you calculated or judged it. Say what it assumes.',
    '- NEEDS_VERIFICATION — a person must confirm it before anyone acts on it.',
    '- HIGH_RISK — it contradicts other work, or being wrong about it would be expensive.',
    'The fourth label, VERIFIED, is not available on this mission. The next section says why.',
    '',
    'Confidence is a number you have to defend, not a mood:',
    '- A claim with nothing in `evidence` cannot go above 0.6, however sure you feel.',
    '- You may not raise the confidence on an earlier agent’s finding. Repeating a claim more',
    '  confidently is not evidence, and the engine puts it back where it started.',
    '',
    'Challenging earlier work is part of the job, not an optional extra. When something upstream is',
    'unsupported, out of date or simply wrong, put it in `issues` with the agent id and the finding id',
    'so the orchestrator can send it back for correction.',
    '',
    'There is no submit tool on this island — ignore any instruction above to call one. Your answer IS',
    'the JSON object you reply with, and nothing else you write reaches the mission. Fill in every',
    'field the schema declares: use "" and [] for the things you genuinely have nothing for, never a',
    'missing key and never a placeholder you invented to look complete.',
  ].join('\n');

  /**
   * The reality of this deployment, said to the model in the same words the
   * page says it to the user. Without this block an agent writes as if it had
   * searched — that is what its training says a research agent does.
   */
  const NO_RETRIEVAL_RULES = [
    '## You cannot retrieve anything, and that changes what you may write',
    '',
    'This island is running inside a published web page. There is no web search, no browser, no',
    'database, no connector and no file — not for you and not for any other agent here. Nothing on',
    'this mission has been looked up and nothing will be. Every word you write is you reasoning from',
    'what you were trained on, and your training has a cutoff.',
    '',
    'So, on this mission:',
    '- Never use the VERIFIED label. Nothing here is verified, because nothing here was retrieved.',
    '  The engine rewrites any VERIFIED to NEEDS_VERIFICATION and records that it had to.',
    '- Never write a URL. Every URL in your answer is deleted before a person sees it and `sources` is',
    '  emptied — a link that may not exist is worse than no link at all.',
    '- Never invent a company’s revenue, a market size, a headcount, a price, a funding round, a date',
    '  or a statistic with a decimal place. If you would be guessing, say what you do not know: an',
    '  information gap is useful to the reader, and a plausible number is the one failure this system',
    '  cannot recover from.',
    '- Keep every confidence at or below 0.6. The engine clamps anything higher, so a 0.9 costs you',
    '  the reader’s trust and buys you nothing.',
    '- Name a company, a regulator or a rule only where you are genuinely confident it exists, and',
    '  label it NEEDS_VERIFICATION so the reader checks it before acting.',
    '',
    'Reasoning from training data is still worth doing well here: structure, mechanisms, what usually',
    'drives a market like this, which questions decide it, what would be expensive to get wrong. Do',
    'that, and be plain about the line between it and fact.',
  ].join('\n');

  const CORRECTION_RULES = [
    '## This is a correction round',
    '',
    'The verification agent rejected specific findings in your earlier output. Work through the listed',
    'issues one at a time, by id. Where you can fix a claim, fix it and say what changed and why.',
    'Where you cannot, set `resolved` to false and explain what is blocking it — an honest unresolved',
    'issue is carried into the final report, whereas a correction that only pretends to fix something',
    'poisons everything downstream of it.',
  ].join('\n');

  function buildSystemPrompt(definition, correcting) {
    const parts = [definition.systemPrompt.trim(), HOUSE_RULES, NO_RETRIEVAL_RULES];
    if (correcting) parts.push(CORRECTION_RULES);
    return parts.join('\n\n');
  }

  function section(title, body) {
    return '## ' + title + '\n' + body;
  }

  function bullets(items, empty) {
    const cleaned = items.map((item) => String(item).trim()).filter(Boolean);
    if (!cleaned.length) return empty;
    return cleaned.map((item) => '- ' + item).join('\n');
  }

  function renderFinding(finding) {
    return (
      '- [' + finding.finding_id + ' · ' + finding.label + ' · confidence ' + finding.confidence + '] ' +
      finding.claim
    );
  }

  function renderHandoff(handoff) {
    const lines = ['### ' + handoff.from_agent + ' → ' + handoff.to_agent];
    if (handoff.completed_work.length) {
      lines.push('What it did:', bullets(handoff.completed_work, '- (nothing recorded)'));
    }
    if (handoff.important_findings.length) {
      lines.push('Findings worth your attention:', handoff.important_findings.map(renderFinding).join('\n'));
    }
    if (handoff.questions_to_check.length) {
      lines.push('It asked you to check:', bullets(handoff.questions_to_check, '- (nothing)'));
    }
    if (handoff.warnings.length) {
      lines.push('It warned you about:', bullets(handoff.warnings, '- (nothing)'));
    }
    return lines.join('\n');
  }

  /**
   * The mission brief, fitted to a budget.
   *
   * `sample` takes 64 KiB of input and the full output of four dependencies can
   * be more than that on its own, so the brief is assembled in priority order:
   * the task, the correction list and the questions always go in whole,
   * dependencies get the space that is left divided between them, and hand-offs
   * take whatever remains. When something is dropped the agent is told it was
   * dropped — reading a partial brief as if it were complete is how an agent
   * ends up confidently answering a question it was never shown.
   */
  function buildUserMessage(definition, envelope, budgetBytes) {
    const blocks = ['# Mission ' + envelope.mission_reference];

    blocks.push(section('The task, in the user’s own words', envelope.original_task.trim()));
    if (envelope.objective) blocks.push(section('Objective', envelope.objective));
    if (envelope.user_requirements.length) {
      blocks.push(section('What the user explicitly asked for', bullets(envelope.user_requirements, '')));
    }
    blocks.push(
      section('Constraints', bullets(envelope.constraints, '- None were given. Say so if that matters.')),
    );
    blocks.push(
      section(
        'Where this is happening',
        [
          '- Geography: ' + (envelope.geography || 'not specified'),
          '- Language: ' + (envelope.language || 'not specified'),
          '- Currency: ' + (envelope.currency || 'not specified') +
            ' — quote every money figure in this currency.',
        ].join('\n'),
      ),
    );
    blocks.push(
      section(
        'Where you are in the pipeline',
        [
          '- Stage: ' + envelope.current_stage,
          '- Agent that ran immediately before you: ' + (envelope.previous_agent || 'none — you are first'),
          '- You are: ' + definition.name + ' (' + definition.id + ') — ' + definition.role,
        ].join('\n'),
      ),
    );

    // The Research Agent's prompt is the server's, and it tells the agent to
    // read this section first. On the server it holds the pages the connectors
    // fetched, or says that none could be. Here it can only ever say the latter:
    // a published page cannot make an outbound request of any kind, so the
    // heading is kept — the prompt refers to it by name — and what sits under
    // it is the truth of this deployment, in the same NO_RESEARCH register the
    // server uses when its connectors return nothing.
    if (definition.id === 'research') {
      blocks.push(
        section(
          'Pages retrieved for you',
          [
            'NO_RESEARCH — nothing was retrieved for this mission, and nothing could have been. This',
            'island runs inside a published web page that cannot make an outbound request, so there',
            'are no connectors here and no web search. Treat that as the state of the evidence: every',
            'fact you write is from your own training, none of it may be labelled VERIFIED, and none',
            'of it may carry a source.',
          ].join('\n'),
        ),
      );
    }

    if (envelope.research_questions.length) {
      blocks.push(
        section(
          'Questions this mission has to answer',
          envelope.research_questions
            .map((item) => '- [' + item.question_id + ' · ' + item.priority + ' priority] ' + item.question)
            .join('\n'),
        ),
      );
    }

    if (envelope.correction) {
      const correction = envelope.correction;
      blocks.push(
        section(
          'CORRECTION REQUIRED — round ' + correction.retry_number + ' of ' + correction.maximum_retries,
          [
            'Your previous output did not survive verification. Fix exactly these findings, nothing else.',
            '',
            correction.issues
              .map((issue) =>
                [
                  '- ' + issue.issue_id + ' · finding ' + (issue.finding_id || '(general)') +
                    ' · severity ' + issue.severity,
                  '  Problem: ' + issue.problem,
                  '  Required action: ' + issue.required_action,
                ].join('\n'),
              )
              .join('\n'),
            '',
            'Return one entry in `corrections` for every issue above, using the same finding ids. If an',
            'issue cannot be resolved, say so with `resolved: false` and explain what is missing.',
          ].join('\n'),
        ),
      );
    }

    if (envelope.instructions) {
      blocks.push(section('Specific instructions for you on this mission', envelope.instructions));
    }

    const spent = () => byteLength(blocks.join('\n\n'));
    const remaining = () => budgetBytes - spent();

    // Dependencies arrive in full: an agent that only sees a summary of the work
    // it is meant to build on re-derives it, badly.
    const dependencies = envelope.previous_outputs;
    if (dependencies.length) {
      const rendered = [];
      // Spent as we go: the block is only pushed at the end, so `remaining()`
      // cannot see what the earlier dependencies in this loop already took.
      let used = 0;
      let left = dependencies.length;
      for (const output of dependencies) {
        const allowance = Math.max(1200, Math.floor((remaining() - used - 2000) / left));
        left -= 1;
        const agent = asText(output.agent) || 'unknown agent';
        const body = clip(JSON.stringify(output, null, 1), allowance);
        used += byteLength(body) + 60;
        rendered.push('### ' + agent + ' — complete output\n```json\n' + body + '\n```');
      }
      blocks.push(section('The agents you depend on, in full', rendered.join('\n\n')));
    }

    // Hand-offs are read newest first, because the agent that ran just before
    // this one is the one whose note matters most.
    const handoffs = envelope.handoffs.slice().reverse();
    const included = [];
    let handoffBytes = 0;
    let dropped = 0;
    for (const handoff of handoffs) {
      const rendered = clip(renderHandoff(handoff), 2600);
      const cost = byteLength(rendered) + 2;
      if (remaining() - handoffBytes - cost < 1500) {
        dropped += 1;
        continue;
      }
      handoffBytes += cost;
      included.push(rendered);
    }
    if (included.length) {
      blocks.push(section('Hand-offs from everyone who has run so far', included.join('\n\n')));
    }
    if (dropped > 0) {
      blocks.push(
        section(
          'What was left out of this brief',
          plural(dropped, 'hand-off') + ' did not fit in the context window and were left out. Do not ' +
            'treat their absence as agreement, and say so if your answer depended on them.',
        ),
      );
    }

    blocks.push(
      section(
        'Source register',
        'Empty, and it stays empty: nothing on this mission was retrieved. Leave every `source_id`, ' +
          '`source_title` and `source_url` as "" and cite nothing.',
      ),
    );

    blocks.push(
      section(
        'Now do your part',
        envelope.correction
          ? 'Work through the correction list above and return the JSON object described below.'
          : 'Do the work this mission needs from ' + definition.name +
            ', then return the JSON object described below. That object is your answer.',
      ),
    );

    return blocks.join('\n\n');
  }

  /**
   * The schema as the MODEL is shown it, which is deliberately not the schema
   * its answer is judged by.
   *
   * VERIFIED is removed from every enum and the confidence ceiling is written
   * into every bound, so the two things this deployment cannot honestly produce
   * are not even on the menu. Validation still runs against the frozen schema
   * from agents.js: a model that writes VERIFIED or 0.9 anyway is corrected by
   * the honesty layer rather than made to spend a repair round on it.
   */
  function promptSchema(schema) {
    const walk = (node) => {
      if (!node || typeof node !== 'object') return node;
      if (Array.isArray(node.enum) && node.enum.includes('VERIFIED')) {
        node.enum = node.enum.filter((value) => value !== 'VERIFIED');
      }
      if (typeof node.description === 'string') {
        node.description = node.description.replace(
          /VERIFIED only with a real cited source\./,
          'VERIFIED is not available on this mission: nothing here was retrieved.',
        );
      }
      if (node.type === 'number' && node.minimum === 0 && node.maximum === 1) {
        node.maximum = CONFIG.confidenceCeiling;
      }
      for (const key of Object.keys(node)) walk(node[key]);
      return node;
    };
    return walk(clone(schema));
  }

  function schemaInstruction(schema) {
    return [
      '## Your answer',
      '',
      'Reply with ONE JSON object and nothing else: no sentence before it, no sentence after it, no',
      'markdown fence. It is parsed by a machine and checked field by field against this schema.',
      '',
      JSON.stringify(schema),
      '',
      'Every property named in `required` must be present. Use "" for a string you have nothing for',
      'and [] for an empty list. Numbers are numbers, not strings. Confidence is between 0 and 0.6.',
    ].join('\n');
  }

  function buildPrompt(definition, envelope, schema) {
    const system = buildSystemPrompt(definition, Boolean(envelope.correction));
    const instruction = schemaInstruction(promptSchema(schema));
    // What is left for the mission brief once the fixed parts and the room a
    // repair round needs are taken out.
    const budget =
      CONFIG.maxPromptBytes - CONFIG.repairReserveBytes - byteLength(system) - byteLength(instruction);
    const user = buildUserMessage(definition, envelope, Math.max(4000, budget));
    return [system, user, instruction].join('\n\n');
  }

  // ---------------------------------------------------------------------------
  // Calling Claude
  // ---------------------------------------------------------------------------

  /** The Chief AI and the verification gate are the two jobs on this island
   *  whose whole value is the quality of the reasoning, so they get the tier
   *  that thinks longest. */
  function modelTierFor(definition) {
    return definition.id === 'chief_ai' || definition.id === 'risk_verification' ? 'complex' : 'default';
  }

  function repairTurns(promptText, previousAnswer, instruction) {
    const allowance = CONFIG.maxPromptBytes - byteLength(promptText) - byteLength(instruction) - 400;
    return [
      { role: 'user', content: promptText },
      { role: 'assistant', content: clip(previousAnswer, Math.max(800, allowance)) },
      { role: 'user', content: instruction },
    ];
  }

  function sampleFailureMessage(definition, code, message) {
    if (code === 'refused') return 'Claude declined to answer for ' + definition.name + '.';
    if (code === 'empty_completion') return 'Claude returned nothing at all for ' + definition.name + '.';
    if (code === 'prompt_too_large') {
      return definition.name + ' could not be briefed: the mission context outgrew what one call takes.';
    }
    if (code === 'invalid_json') {
      return definition.name + ' never returned parseable JSON, after being asked again.';
    }
    return definition.name + ' could not be reached: ' + (message || code) + '.';
  }

  /**
   * One agent's answer, validated, with the repair round trips the repo's
   * provider does — the schema is in the words of the prompt because `sample`
   * has no tool to force it.
   *
   * Two attempts after the first, then the agent is failed. The loop below is
   * bounded on every path: schema repairs are counted, a rate limit buys one
   * backoff and no more, and everything else either fails the agent or ends the
   * mission. Nothing here retries in a loop.
   */
  async function askModel(ctx, definition, schema, promptText) {
    const sample = await useSample();
    if (!sample) {
      throw fatalSampleError(
        'This page cannot reach Claude, so no agent can run. Open the artifact in Claude and allow it ' +
          'to use Claude on your account.',
        'not_granted',
      );
    }

    const options = {
      modelTier: modelTierFor(definition),
      signal: ctx.handle.controller.signal,
      // Every mission must genuinely ask: a replayed answer would make a second
      // run look like agreement when it is only a cache.
      cache: false,
    };

    let input = promptText;
    let repairs = 0;
    let backedOff = false;

    for (;;) {
      ensureLive(ctx.handle);
      let raw;
      try {
        raw = await sample.json(input, options);
      } catch (error) {
        const code = asText(error && error.code) || 'upstream_error';
        const message = asText(error && error.message);

        if (code === 'cancelled') throw missionAborted();

        if (SAMPLE_GONE.has(code)) {
          sampleGone = message || code;
          throw fatalSampleError(
            'Claude is not available to this page any more (' + code + '), so the mission cannot ' +
              'continue. ' + message,
            code,
          );
        }

        if (code === 'rate_limited') {
          if (backedOff) {
            throw fatalSampleError(
              'Claude is rate-limiting this page, so the mission has stopped rather than hammering it. ' +
                'Give it a few minutes and start a new mission.',
              code,
            );
          }
          backedOff = true;
          emit(
            ctx,
            'log',
            'Claude rate-limited this page, so ' + definition.name + ' is waiting ' +
              Math.round(CONFIG.rateLimitBackoffMs / 1000) + ' seconds before asking once more.',
            { code: code },
            definition.id,
          );
          await delay(CONFIG.rateLimitBackoffMs, ctx.handle.controller.signal);
          continue;
        }

        if (code === 'invalid_json' && repairs < CONFIG.maxRepairs) {
          repairs += 1;
          emit(
            ctx,
            'agent_retrying',
            definition.name + ' replied with something that was not JSON, so it was asked again (' +
              repairs + ' of ' + CONFIG.maxRepairs + ').',
            { repairs: repairs, code: code },
            definition.id,
          );
          input = repairTurns(
            promptText,
            asText(error && error.text) || '(nothing readable)',
            'That was not one JSON object. Reply again with the JSON object the schema describes and ' +
              'nothing else: no explanation, no markdown fence, no text before or after it.',
          );
          continue;
        }

        throw agentFailure(definition.id, sampleFailureMessage(definition, code, message), []);
      }

      const answerChars = JSON.stringify(raw === undefined ? null : raw).length;
      const checked = normaliseAndValidate(raw, schema);
      if (checked.issues.length === 0) {
        return { output: checked.value, repairs: repairs, answerChars: answerChars };
      }

      if (repairs >= CONFIG.maxRepairs) {
        throw agentFailure(
          definition.id,
          definition.name + ' returned a report that does not match its schema.',
          checked.issues,
        );
      }

      repairs += 1;
      emit(
        ctx,
        'agent_retrying',
        definition.name + ' returned output that does not match its schema, so it was sent the ' +
          plural(checked.issues.length, 'problem') + ' and asked again (' + repairs + ' of ' +
          CONFIG.maxRepairs + ').',
        { repairs: repairs, issues: checked.issues.slice(0, 10) },
        definition.id,
      );
      input = repairTurns(
        promptText,
        clip(JSON.stringify(raw), 12000),
        [
          'Your answer did not match the schema. These are the problems, each as a path into your',
          'object:',
          '',
          describeIssues(checked.issues),
          '',
          'Reply again with the whole corrected JSON object — not a patch, not an apology, and nothing',
          'outside the object. Keep everything that was already right.',
        ].join('\n'),
      );
    }
  }

  // ---------------------------------------------------------------------------
  // THE HONESTY LAYER
  // ---------------------------------------------------------------------------

  /**
   * Rewrites what an agent claimed into what this deployment can honestly say,
   * before anything downstream — another agent, the gate, the report, the
   * screen — is allowed to read it.
   *
   * THIS IS NOT DEFENSIVE NOISE. A published artifact cannot reach the open
   * web: the CSP blocks every host, there are no connectors on this account,
   * and the Claude behind `sample` has no web_search tool. So not one claim on
   * this island was retrieved; every one of them is a model recalling and
   * reasoning. An agent that writes VERIFIED, or 0.9, or a URL is therefore
   * saying something untrue — and saying it in the exact register a person acts
   * on. That is the failure the whole product exists to prevent, so the engine
   * refuses to pass it on:
   *
   *   VERIFIED          → NEEDS_VERIFICATION   nothing retrieved, nothing verified
   *   confidence > 0.6  → 0.6                  the ceiling for an unsourced claim
   *   sources, URLs     → dropped              a link that may not exist is worse
   *                                            than no link at all
   *
   * Every rewrite is counted and said out loud in the timeline, because a
   * silent correction would be its own kind of dishonesty. Delete this function
   * and the page does not become braver; it becomes a fabrication engine with
   * good typography.
   */
  function enforceNoRetrievalHonesty(ctx, agentId, output) {
    const counts = { labels: 0, confidences: 0, citations: 0, sourceLists: 0, verifiedCounts: 0 };

    const walk = (node) => {
      if (Array.isArray(node)) {
        for (const item of node) walk(item);
        return;
      }
      if (!node || typeof node !== 'object') return;

      for (const key of Object.keys(node)) {
        const value = node[key];

        if (key === 'label' && value === 'VERIFIED') {
          node[key] = 'NEEDS_VERIFICATION';
          counts.labels += 1;
          continue;
        }

        if ((key === 'confidence' || key === 'overall_confidence') && typeof value === 'number') {
          if (value > CONFIG.confidenceCeiling) {
            node[key] = CONFIG.confidenceCeiling;
            counts.confidences += 1;
          }
          continue;
        }

        if (key === 'sources' && Array.isArray(value)) {
          if (value.length > 0) {
            counts.sourceLists += 1;
            counts.citations += value.length;
          }
          node[key] = [];
          continue;
        }

        // The verification agent's own tally of "claims properly supported by a
        // real source". There are no real sources here, so the true count is 0.
        if (key === 'verified' && typeof value === 'number' && value > 0 && 'total_claims_reviewed' in node) {
          node[key] = 0;
          counts.verifiedCounts += value;
          continue;
        }

        if ((key === 'source_url' || key === 'source_id' || key === 'source_title') && asText(value)) {
          // The ids point into a register that is empty by construction, so a
          // kept id is as much a dangling promise as a kept URL.
          if (key === 'source_url') counts.citations += 1;
          node[key] = '';
          continue;
        }

        walk(value);
      }
    };

    walk(output);

    if (counts.labels || counts.confidences || counts.citations || counts.verifiedCounts) {
      const parts = [];
      if (counts.labels) parts.push(plural(counts.labels, 'claim') + ' labelled VERIFIED, now NEEDS_VERIFICATION');
      if (counts.verifiedCounts) {
        parts.push(plural(counts.verifiedCounts, 'claim') + ' counted as verified against a source, now 0');
      }
      if (counts.confidences) {
        parts.push(plural(counts.confidences, 'confidence') + ' above ' + CONFIG.confidenceCeiling +
          ', clamped to ' + CONFIG.confidenceCeiling);
      }
      if (counts.citations) parts.push(plural(counts.citations, 'citation') + ' dropped');
      emit(
        ctx,
        'log',
        agentName(agentId) + ' wrote as if it had looked things up. Nothing on this island is ' +
          'retrieved, so the engine corrected it before anyone downstream read it: ' + parts.join('; ') + '.',
        counts,
        agentId,
      );
    }

    return counts;
  }

  // ---------------------------------------------------------------------------
  // Mission context: what the loop knows while it runs
  // ---------------------------------------------------------------------------

  /** One live mission per entry. The controller's signal reaches `sample`, so
   *  an abort stops an agent mid-call rather than after it. */
  const active = new Map();

  /** Page-wide event listeners. The UI subscribes once and follows whichever
   *  mission is on screen, rather than re-subscribing per mission. */
  const listeners = new Set();

  function onEvent(handler) {
    if (typeof handler !== 'function') return () => {};
    listeners.add(handler);
    return () => listeners.delete(handler);
  }

  function broadcast(event) {
    for (const handler of listeners) {
      try {
        handler(clone(event));
      } catch (error) {
        console.error('[island] an onEvent listener threw', error);
      }
    }
  }

  function notify(ctx, name, payload) {
    const handler = ctx.handlers[name];
    if (typeof handler !== 'function') return;
    try {
      handler(clone(payload));
    } catch (error) {
      // A rendering bug in the page must never take the mission down with it.
      console.error('[island] a ' + name + ' handler threw', error);
    }
  }

  function flushEvents(ctx) {
    if (ctx.flushTimer) {
      clearTimeout(ctx.flushTimer);
      ctx.flushTimer = null;
    }
    ctx.mission.heartbeatAt = nowIso();
    return saveEvents(ctx.mission.id, ctx.events, ctx.mission.heartbeatAt);
  }

  function scheduleFlush(ctx) {
    if (ctx.flushTimer) return;
    ctx.flushTimer = setTimeout(() => {
      ctx.flushTimer = null;
      flushEvents(ctx);
    }, CONFIG.eventFlushMs);
  }

  function emit(ctx, type, message, payload, agentId) {
    const event = {
      id: newId('evt'),
      missionId: ctx.mission.id,
      seq: ctx.nextSeq,
      type: type,
      agentId: agentId || null,
      payload: payload || {},
      message: message,
      createdAt: nowIso(),
    };
    ctx.nextSeq += 1;
    ctx.events.push(event);
    // One document holds the timeline, so the tail is what survives a long run.
    if (ctx.events.length > CONFIG.maxStoredEvents) ctx.events.splice(0, ctx.events.length - CONFIG.maxStoredEvents);
    notify(ctx, 'onEvent', event);
    broadcast(event);
    scheduleFlush(ctx);
    return event;
  }

  function updateMission(ctx, patch) {
    Object.assign(ctx.mission, patch);
    ctx.mission.heartbeatAt = nowIso();
    notify(ctx, 'onMission', ctx.mission);
    saveMission(ctx.mission);
  }

  /** A run row that is never left open: an agent row with no completedAt is the
   *  same lie at agent level that a running mission with no loop is at mission
   *  level. */
  function startRun(ctx, definition, attempt, round, envelope, promptChars) {
    const run = {
      id: newId('run'),
      missionId: ctx.mission.id,
      agentId: definition.id,
      attempt: attempt,
      round: round,
      status: 'working',
      input: trimEnvelopeForStorage(envelope),
      output: null,
      error: null,
      confidence: null,
      startedAt: nowIso(),
      completedAt: null,
      durationMs: null,
      // `sample` reports no usage, so the honest token counts are null rather
      // than zero. What the page can show instead is the size of each brief.
      inputTokens: null,
      outputTokens: null,
      promptChars: promptChars || 0,
      answerChars: null,
      repairs: 0,
      notes: '',
    };
    ctx.runs.push(run);
    notify(ctx, 'onRun', run);
    saveRun(run);
    return run;
  }

  function finishRun(ctx, run, patch) {
    Object.assign(run, patch);
    run.completedAt = nowIso();
    run.durationMs = Date.parse(run.completedAt) - Date.parse(run.startedAt);
    notify(ctx, 'onRun', run);
    saveRun(run);
    return run;
  }

  /**
   * What is kept of an agent's brief.
   *
   * The whole brief includes the full output of every dependency, which would
   * push a single run past the 256 KiB a document holds. So the audit row keeps
   * what tells a reader what this agent knew — the task, the questions, who it
   * read, what it was asked to correct — and the size of the rest.
   */
  function trimEnvelopeForStorage(envelope) {
    return {
      mission_id: envelope.mission_id,
      mission_reference: envelope.mission_reference,
      original_task: envelope.original_task,
      objective: envelope.objective,
      constraints: envelope.constraints,
      geography: envelope.geography,
      language: envelope.language,
      currency: envelope.currency,
      current_stage: envelope.current_stage,
      previous_agent: envelope.previous_agent,
      research_questions: envelope.research_questions,
      dependencies_read: envelope.previous_outputs.map((output) => asText(output.agent)).filter(Boolean),
      handoffs_read: envelope.handoffs.map((handoff) => handoff.from_agent),
      correction: envelope.correction || null,
      instructions: envelope.instructions,
    };
  }

  // ---------------------------------------------------------------------------
  // Pause and abort
  // ---------------------------------------------------------------------------

  function ensureLive(handle) {
    if (handle.controller.signal.aborted) throw missionAborted();
  }

  /** Resolves when the named resolver is called, or immediately on abort. */
  function waitFor(handle, slot) {
    return new Promise((resolve) => {
      if (handle.controller.signal.aborted) {
        resolve();
        return;
      }
      const finish = () => {
        handle.controller.signal.removeEventListener('abort', finish);
        handle[slot] = null;
        resolve();
      };
      handle[slot] = finish;
      handle.controller.signal.addEventListener('abort', finish, { once: true });
    });
  }

  /** Checked before every agent: an abort stops the mission, a pause holds it. */
  async function gate(handle) {
    ensureLive(handle);
    while (handle.paused) {
      await waitFor(handle, 'resumeResolver');
      ensureLive(handle);
    }
  }

  /** In approval mode the island stops at the top of every stage and waits for
   *  a person to read what came before it. */
  async function awaitApproval(ctx, stage) {
    if (ctx.mission.mode !== 'approval') return;
    updateMission(ctx, { status: 'awaiting_approval', pendingApprovalStage: stage });
    emit(
      ctx,
      'approval_required',
      'The ' + STAGE_LABEL[stage] + ' stage is ready to start and is waiting for your approval.',
      { stage: stage },
    );
    flushEvents(ctx);
    await waitFor(ctx.handle, 'approvalResolver');
    ensureLive(ctx.handle);
  }

  // ---------------------------------------------------------------------------
  // The envelope each agent is given
  // ---------------------------------------------------------------------------

  function importantFindings(output, limit) {
    const weight = (importance) => (importance === 'high' ? 0 : importance === 'medium' ? 1 : 2);
    return output.findings
      .slice()
      .sort((a, b) => weight(a.importance) - weight(b.importance))
      .slice(0, limit || 8);
  }

  function buildHandoff(ctx, fromId, to) {
    const output = ctx.outputs.get(fromId);
    if (!output) return null;
    const definition = getAgent(fromId);

    const completedWork = [
      (definition ? definition.role : fromId) + ': ' + plural(output.findings.length, 'finding') + ', ' +
        plural(output.issues.length, 'issue') + ' raised, overall confidence ' + percent(output.confidence) + '.',
    ].concat(output.recommendations.slice(0, 3).map((entry) => entry.action));

    const questions = [asText(output.next_agent_instructions)]
      .concat(output.issues.filter((issue) => issue.target_agent === to.id).map((issue) => issue.required_action))
      .filter(Boolean);

    return {
      from_agent: fromId,
      to_agent: to.id,
      mission_id: ctx.mission.id,
      completed_work: completedWork.filter(Boolean),
      important_findings: importantFindings(output),
      questions_to_check: questions,
      warnings: output.issues.filter((issue) => issue.severity === 'high').map((issue) => issue.problem),
    };
  }

  function instructionsFor(ctx, definition) {
    const lines = [];

    const reason = ctx.plan.reasons.get(definition.id);
    if (reason) lines.push('The Task Manager put you on this mission because: ' + reason);

    const previous = ctx.order.slice().reverse().find((id) => id !== definition.id);
    const note = previous ? asText((ctx.outputs.get(previous) || {}).next_agent_instructions) : '';
    if (previous && note) lines.push(previous + ' left this note for whoever came next: ' + note);

    for (const [from, output] of ctx.outputs) {
      if (from === definition.id) continue;
      for (const issue of output.issues) {
        if (issue.target_agent !== definition.id) continue;
        lines.push(
          from + ' raised ' + issue.issue_id + ' against you: ' + issue.problem + ' Required: ' +
            issue.required_action,
        );
      }
    }

    return lines.join('\n');
  }

  function buildEnvelope(ctx, definition, correction) {
    const dependencies = definition.dependsOn
      .map((id) => ctx.outputs.get(id))
      .filter((output) => output !== undefined);

    const handoffs = ctx.order
      .filter((id) => id !== definition.id)
      .map((id) => buildHandoff(ctx, id, definition))
      .filter((handoff) => handoff !== null);

    return {
      mission_id: ctx.mission.id,
      mission_reference: ctx.mission.reference,
      original_task: ctx.mission.userTask,
      objective: ctx.mission.objective || ctx.plan.objective,
      user_requirements: ctx.mission.userRequirements,
      constraints: ctx.mission.constraints.length ? ctx.mission.constraints : ctx.plan.constraints,
      geography: ctx.mission.geography,
      language: ctx.mission.language,
      currency: ctx.mission.currency,
      current_stage: definition.stage,
      previous_agent: ctx.order.slice().reverse().find((id) => id !== definition.id) || null,
      previous_outputs: dependencies,
      handoffs: handoffs,
      research_questions: ctx.plan.questions,
      correction: correction || null,
      instructions: instructionsFor(ctx, definition),
    };
  }

  // ---------------------------------------------------------------------------
  // Confidence monotonicity
  // ---------------------------------------------------------------------------

  function registerOrigins(ctx, agentId, output) {
    for (const finding of output.findings) {
      if (!finding.finding_id) continue;
      const keys = finding.evidence.map(evidenceKey).filter(Boolean);
      const existing = ctx.origins.get(finding.finding_id);

      if (existing) {
        // The agent that made a claim may revise its own confidence; everyone
        // else is held to what it first said.
        if (existing.agentId !== agentId) continue;
        for (const key of keys) existing.evidence.add(key);
        existing.confidence = finding.confidence;
        existing.claim = finding.claim;
        continue;
      }

      ctx.origins.set(finding.finding_id, {
        agentId: agentId,
        confidence: finding.confidence,
        claim: finding.claim,
        evidence: new Set(keys),
      });
      const key = claimKey(finding.claim);
      if (key && !ctx.claimOrigins.has(key)) ctx.claimOrigins.set(key, finding.finding_id);
    }
  }

  /**
   * Stops false certainty accumulating down the chain.
   *
   * Restating someone else's claim more confidently is the cheapest way for a
   * pipeline to manufacture authority it never earned, and it is invisible in
   * the final report unless it is caught here. So a later agent that repeats a
   * finding at a higher confidence, with no source the originating agent did
   * not already have, is put back to the confidence the claim was born with —
   * and the timeline says so, because a silent clamp would be its own kind of
   * dishonesty. Here the evidence test can never pass, because there is no
   * evidence to attach, so on this deployment the rule is absolute.
   */
  function clampRestatedConfidence(ctx, agentId, output) {
    for (const finding of output.findings) {
      const originId = ctx.origins.has(finding.finding_id)
        ? finding.finding_id
        : ctx.claimOrigins.get(claimKey(finding.claim));
      const origin = originId ? ctx.origins.get(originId) : undefined;
      if (!origin || origin.agentId === agentId) continue;
      if (finding.confidence <= origin.confidence) continue;

      const fresh = finding.evidence.map(evidenceKey).filter((key) => key && !origin.evidence.has(key));
      if (fresh.length > 0) continue;

      const raised = finding.confidence;
      finding.confidence = origin.confidence;
      emit(
        ctx,
        'log',
        agentName(agentId) + ' restated ' + (originId || finding.finding_id) + ' at confidence ' + raised +
          ' without attaching new evidence. ' + agentName(origin.agentId) + ' first made that claim at ' +
          origin.confidence + ', so it has been clamped back to ' + origin.confidence + '.',
        {
          finding_id: originId || finding.finding_id,
          origin_agent: origin.agentId,
          from: raised,
          to: origin.confidence,
        },
        agentId,
      );
    }
  }

  /**
   * The same rule applied to the Chief AI's headline findings, which cite by id
   * rather than restate. Every reference it can give is a finding already on
   * record — there are no sources on this island to cite instead — so the Chief
   * has added no evidence, and cannot be more confident than the most confident
   * agent it is quoting.
   */
  function clampChiefConfidence(ctx, output) {
    for (const raw of asArray(output.key_findings)) {
      const entry = asRecord(raw);
      const references = asArray(entry.evidence).map(asText).filter(Boolean);
      if (references.length === 0) continue;

      const cited = references.map((reference) => ctx.origins.get(reference)).filter(Boolean);
      if (cited.length === 0) continue;

      const ceiling = Math.max.apply(null, cited.map((origin) => origin.confidence));
      const stated = asNumber(entry.confidence, ceiling);
      if (stated <= ceiling) continue;

      entry.confidence = ceiling;
      emit(
        ctx,
        'log',
        'chief_ai restated ' + references.join(', ') + ' at confidence ' + stated + ' without attaching ' +
          'new evidence. The agents that made those claims went no higher than ' + ceiling + ', so it has ' +
          'been clamped back to ' + ceiling + '.',
        { references: references, from: stated, to: ceiling },
        'chief_ai',
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Challenges — one agent taking issue with another's work
  // ---------------------------------------------------------------------------

  function recordCorrection(ctx, record) {
    const entry = Object.assign({ id: newId('cor'), missionId: ctx.mission.id, createdAt: nowIso() }, record);
    ctx.corrections.push(entry);
    saveAudit(ctx.mission.id, { corrections: ctx.corrections, verifications: ctx.verifications });
    return entry;
  }

  function recordChallenges(ctx, agentId, output, round) {
    for (const issue of output.issues) {
      const target = asText(issue.target_agent);
      if (!target || target === agentId) continue;

      const origin = ctx.origins.get(issue.target_finding_id);
      recordCorrection(ctx, {
        findingId: issue.target_finding_id,
        fromAgent: agentId,
        toAgent: target,
        originalClaim: origin ? origin.claim : '',
        correctedClaim: '',
        reason: issue.problem,
        severity: issue.severity,
        round: round,
        resolved: false,
      });
      emit(
        ctx,
        'challenge',
        agentName(agentId) + ' challenged ' + agentName(target) +
          (issue.target_finding_id ? ' over ' + issue.target_finding_id : '') + ': ' + issue.problem,
        {
          target_agent: target,
          finding_id: issue.target_finding_id,
          severity: issue.severity,
          issue_id: issue.issue_id,
          original_claim: origin ? origin.claim : '',
        },
        agentId,
      );
    }

    // The competitor schema carries its corrections in a field of its own, and
    // "there are no competitors" is the claim most often wrong on this island.
    for (const raw of asArray(output.previous_claims_challenged)) {
      const entry = asRecord(raw);
      const findingId = asText(entry.finding_id);
      const origin = ctx.origins.get(findingId);
      const challenge = asText(entry.challenge);
      if (!challenge) continue;

      recordCorrection(ctx, {
        findingId: findingId,
        fromAgent: agentId,
        toAgent: origin ? origin.agentId : '',
        originalClaim: asText(entry.original_claim) || (origin ? origin.claim : ''),
        correctedClaim: asText(entry.corrected_claim),
        reason: challenge,
        severity: asLevel(entry.severity),
        round: round,
        resolved: false,
      });
      emit(
        ctx,
        'challenge',
        agentName(agentId) + ' corrected ' + (findingId || 'an earlier claim') +
          (origin ? ' from ' + agentName(origin.agentId) : '') + ': ' + challenge,
        {
          finding_id: findingId,
          target_agent: origin ? origin.agentId : '',
          severity: asLevel(entry.severity),
          original_claim: asText(entry.original_claim) || (origin ? origin.claim : ''),
          corrected_claim: asText(entry.corrected_claim),
        },
        agentId,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Running one agent
  // ---------------------------------------------------------------------------

  async function invokeAgent(ctx, definition, attempt, round, correction) {
    const envelope = buildEnvelope(ctx, definition, correction);
    const schema = correction ? correctionSchema(definition) : definition.schema;
    const prompt = buildPrompt(definition, envelope, schema);
    const run = startRun(ctx, definition, attempt, round, envelope, prompt.length);

    emit(
      ctx,
      'agent_started',
      correction
        ? definition.name + ' started a correction round on ' +
          plural(correction.issues.length, 'flagged finding') + '.'
        : definition.name + ' started work.',
      { attempt: attempt, round: round, correcting: Boolean(correction) },
      definition.id,
    );

    try {
      const answer = await askModel(ctx, definition, schema, prompt);

      // Validated, and now made honest: nothing downstream — not the next
      // agent, not the gate, not the report — ever sees the raw claim.
      const honesty = enforceNoRetrievalHonesty(ctx, definition.id, answer.output);
      ctx.honesty.labels += honesty.labels;
      ctx.honesty.confidences += honesty.confidences;
      ctx.honesty.citations += honesty.citations;

      return {
        run: run,
        output: answer.output,
        repairs: answer.repairs,
        answerChars: answer.answerChars,
      };
    } catch (error) {
      finishRun(ctx, run, {
        status: error && error.aborted ? 'skipped' : 'failed',
        error: error && error.message ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * One agent, from invocation to a recorded outcome. Null means it failed:
   * the repair round trips happen inside `askModel`, and past them there is
   * nowhere else to go — this roster defines no backup agents.
   */
  async function attemptAgent(ctx, definition, round, correction) {
    try {
      return await invokeAgent(ctx, definition, 1, round, correction);
    } catch (error) {
      if (error && error.aborted) throw error;
      // Claude itself is gone; every later agent would fail the same way.
      if (error && error.fatal) throw error;

      emit(
        ctx,
        'agent_failed',
        definition.name + ' failed: ' + (error && error.message ? error.message : String(error)),
        { round: round, issues: (error && error.issues) || [] },
        definition.id,
      );
      return null;
    }
  }

  /**
   * A normal (non-correction) run of one agent, from invocation to stored
   * output. Null means the agent failed and its slot stays empty — downstream
   * agents that depended on it are marked blocked rather than run on a hole,
   * and a failed agent is never reported as completed.
   */
  async function runStandardAgent(ctx, definition, round) {
    const attempted = await attemptAgent(ctx, definition, round, null);
    if (!attempted) {
      ctx.failed.add(definition.id);
      return null;
    }

    const output = attempted.output;

    clampRestatedConfidence(ctx, definition.id, output);
    if (definition.id === 'chief_ai') clampChiefConfidence(ctx, output);

    finishRun(ctx, attempted.run, {
      status: 'completed',
      output: output,
      confidence: output.confidence,
      repairs: attempted.repairs,
      answerChars: attempted.answerChars,
    });

    registerOrigins(ctx, definition.id, output);
    ctx.outputs.set(definition.id, output);
    ctx.failed.delete(definition.id);
    if (!ctx.order.includes(definition.id)) ctx.order.push(definition.id);

    emit(
      ctx,
      'agent_completed',
      definition.name + ' finished: ' + plural(output.findings.length, 'finding') + ', ' +
        plural(output.issues.length, 'issue') + ' raised, confidence ' + percent(output.confidence) + '.',
      {
        round: round,
        confidence: output.confidence,
        findings: output.findings.length,
        issues: output.issues.length,
        repairs: attempted.repairs,
      },
      definition.id,
    );

    recordChallenges(ctx, definition.id, output, round);

    for (const downstream of ctx.selected) {
      const dependent = requireAgent(downstream);
      if (!dependent.dependsOn.includes(definition.id)) continue;
      emit(
        ctx,
        'handoff',
        definition.name + ' handed its work to ' + dependent.name + '.',
        { from: definition.id, to: dependent.id },
        definition.id,
      );
    }

    return output;
  }

  /** An agent whose dependency never produced anything. Recorded as blocked,
   *  with a run row saying what it was waiting for — never quietly dropped. */
  function markBlocked(ctx, definition, missing) {
    const reason =
      definition.name + ' could not run: it depends on ' + missing.map(agentName).join(' and ') +
      ', which did not complete.';
    const run = startRun(ctx, definition, 1, 0, buildEnvelope(ctx, definition, null), 0);
    finishRun(ctx, run, { status: 'blocked', error: reason });
    ctx.failed.add(definition.id);
    emit(ctx, 'agent_skipped', reason, { reason: 'blocked', dependencies: missing }, definition.id);
  }

  /**
   * Every agent that was still waiting for its turn when Claude went away.
   *
   * Each one gets a run row — status `skipped`, the error being the message
   * Claude gave — and a line in the timeline, so the report's roster names it
   * by what happened to it rather than showing a blank where its work would
   * have been. An agent that already has a row is left alone: it either
   * finished before the model went, or it is the one that found out. Nothing is
   * retried. The codes that reach here (`not_granted`, the SAMPLE_GONE set,
   * `rate_limited` once the back-off has already been spent) all mean this view
   * will not reach Claude again during this mission, and asking once more would
   * only write the same error under another name.
   */
  function markModelUnavailable(ctx, agentIds, fatal) {
    for (const agentId of agentIds) {
      if (ctx.runs.some((run) => run.agentId === agentId)) continue;
      const definition = requireAgent(agentId);
      const run = startRun(ctx, definition, 1, 0, buildEnvelope(ctx, definition, null), 0);
      finishRun(ctx, run, { status: 'skipped', error: fatal.message });
      ctx.failed.add(definition.id);
      emit(
        ctx,
        'agent_skipped',
        definition.name + ' never ran: ' + fatal.message,
        { reason: 'model_unavailable', code: fatal.code || '' },
        definition.id,
      );
    }
  }

  /**
   * Runs a wave with at most `limit` agents in flight.
   *
   * Every lane is awaited even when one of them throws, because an abort that
   * unwound the mission while two agents were still mid-call would close the
   * mission out and then let those agents write their runs afterwards.
   */
  async function runPool(items, limit, worker) {
    const errors = [];
    let cursor = 0;
    // Raised the moment a lane learns that Claude is gone. The lanes still in a
    // call finish it, but nobody picks up another item: every agent left in the
    // queue would only make the same doomed call, and the mission loop is what
    // gives each of them a run row saying it never got its turn.
    let halted = false;

    const lanes = [];
    const laneCount = Math.min(Math.max(1, limit), items.length);
    for (let lane = 0; lane < laneCount; lane += 1) {
      lanes.push(
        (async () => {
          for (;;) {
            if (halted) return;
            const item = items[cursor];
            cursor += 1;
            if (item === undefined) return;
            try {
              await worker(item);
            } catch (error) {
              if (error && error.fatal) halted = true;
              errors.push(error);
            }
          }
        })(),
      );
    }
    await Promise.all(lanes);

    const aborted = errors.find((error) => error && error.aborted);
    if (aborted) throw aborted;
    // Claude being gone outranks whatever else went wrong in the wave: it is
    // the error the mission loop knows how to keep a record of.
    const fatal = errors.find((error) => error && error.fatal);
    if (fatal) throw fatal;
    if (errors.length > 0) throw errors[0];
  }

  // ---------------------------------------------------------------------------
  // The verification gate and the correction loop
  // ---------------------------------------------------------------------------

  function readGate(output) {
    return {
      passed: output.verification_passed === true,
      flags: asArray(output.flagged_findings).map((raw) => {
        const entry = asRecord(raw);
        return {
          findingId: asText(entry.finding_id),
          agent: asText(entry.agent),
          reason: asText(entry.reason),
          severity: asLevel(entry.severity, 'high'),
          action: asText(entry.recommended_action),
        };
      }),
      verified: asArray(output.verified_findings).map(asText).filter(Boolean),
      contradictions: asArray(output.contradictions).map((raw) => {
        const entry = asRecord(raw);
        return {
          conflict: asText(entry.conflict) ||
            [asText(entry.claim_a), asText(entry.claim_b)].filter(Boolean).join(' vs '),
          resolution: asText(entry.resolution),
        };
      }),
    };
  }

  function recordVerification(ctx, record) {
    const entry = Object.assign({ id: newId('ver'), missionId: ctx.mission.id, createdAt: nowIso() }, record);
    ctx.verifications.push(entry);
    return entry;
  }

  function persistGate(ctx, reading, round) {
    for (const findingId of reading.verified) {
      recordVerification(ctx, {
        findingId: findingId,
        agentId: (ctx.origins.get(findingId) || {}).agentId || '',
        // Deliberately not called verified in the reason: the gate checked this
        // claim for internal consistency, which is all anyone here can do.
        status: 'checked',
        reason:
          'The verification agent read this claim against the rest of the mission and found nothing ' +
          'wrong with it. Nothing was retrieved, so that is consistency, not confirmation.',
        severity: 'low',
        recommendedAction: 'Confirm it against a real source before acting on it.',
        correctedValue: '',
        resolved: false,
        round: round,
      });
    }

    for (const flag of reading.flags) {
      recordVerification(ctx, {
        findingId: flag.findingId,
        agentId: flag.agent || (ctx.origins.get(flag.findingId) || {}).agentId || '',
        status: flag.severity === 'high' ? 'high_risk' : 'needs_verification',
        reason: flag.reason,
        severity: flag.severity,
        recommendedAction: flag.action,
        correctedValue: '',
        resolved: false,
        round: round,
      });
    }

    for (const contradiction of reading.contradictions) {
      if (!contradiction.conflict) continue;
      recordVerification(ctx, {
        findingId: '',
        agentId: '',
        status: 'contradiction',
        reason: contradiction.conflict,
        severity: 'high',
        recommendedAction: contradiction.resolution,
        correctedValue: '',
        resolved: Boolean(contradiction.resolution),
        round: round,
      });
    }

    saveAudit(ctx.mission.id, { corrections: ctx.corrections, verifications: ctx.verifications });

    emit(
      ctx,
      'verification_result',
      reading.passed
        ? 'Verification passed on round ' + round + ': ' + plural(reading.verified.length, 'finding') +
          ' hold together and nothing is left flagged.'
        : 'Verification failed on round ' + round + ': ' + plural(reading.flags.length, 'finding') +
          ' flagged and ' + plural(reading.contradictions.length, 'contradiction') + ' found.',
      {
        round: round,
        passed: reading.passed,
        flagged: reading.flags.length,
        verified: reading.verified.length,
        contradictions: reading.contradictions.length,
      },
      'risk_verification',
    );
  }

  /** Which agent has to answer for a flagged finding: whoever the verifier
   *  named, or failing that whoever first made the claim. */
  function routeFlags(ctx, flags, round) {
    const byAgent = new Map();
    const unroutable = [];

    flags.forEach((flag, index) => {
      const named = flag.agent && ctx.outputs.has(flag.agent) ? flag.agent : '';
      const owner = named || (ctx.origins.get(flag.findingId) || {}).agentId || '';
      if (!owner || owner === 'risk_verification' || !ctx.outputs.has(owner)) {
        unroutable.push(flag);
        return;
      }
      const issues = byAgent.get(owner) || [];
      issues.push({
        issue_id: 'V' + round + '-' + (index + 1),
        agent: owner,
        finding_id: flag.findingId,
        problem: flag.reason,
        severity: flag.severity,
        required_action: flag.action,
      });
      byAgent.set(owner, issues);
    });

    return { byAgent: byAgent, unroutable: unroutable };
  }

  /**
   * Folds a correction round back into the agent's stored output.
   *
   * The original run row is left exactly as it was — a correction is a new run,
   * and the audit trail is worth more than a tidy history. What changes is the
   * output the rest of the mission reads: corrected claims replace the ones
   * they correct, a claim the agent could not settle is relabelled rather than
   * quietly kept, and every change is recorded with the text before and after.
   */
  function mergeCorrection(ctx, definition, previous, correction, issues, round) {
    const merged = clone(previous);
    const byFinding = new Map(issues.map((issue) => [issue.finding_id, issue]));
    let resolved = 0;
    let unresolved = 0;

    for (const raw of asArray(correction.corrections)) {
      const entry = asRecord(raw);
      const findingId = asText(entry.finding_id);
      const correctedClaim = asText(entry.corrected_claim);
      const wasResolved = entry.resolved === true;
      const severity = (byFinding.get(findingId) || {}).severity || 'medium';

      const finding = merged.findings.find((candidate) => candidate.finding_id === findingId);
      const originalClaim = finding ? finding.claim : asText(entry.previous_claim);

      if (finding && correctedClaim) finding.claim = correctedClaim;
      if (finding && !wasResolved) {
        // An issue the agent could not settle must not keep a label that says
        // it is settled; the report carries it as unresolved either way.
        finding.label = severity === 'high' ? 'HIGH_RISK' : 'NEEDS_VERIFICATION';
      }

      recordCorrection(ctx, {
        findingId: findingId,
        fromAgent: 'risk_verification',
        toAgent: definition.id,
        originalClaim: originalClaim,
        correctedClaim: correctedClaim || originalClaim,
        reason: asText(entry.reason_for_change),
        severity: severity,
        round: round,
        resolved: wasResolved,
      });

      if (wasResolved) {
        resolved += 1;
        for (const record of ctx.verifications) {
          if (record.findingId === findingId && !record.resolved) {
            record.resolved = true;
            record.correctedValue = correctedClaim || originalClaim;
          }
        }
      } else {
        unresolved += 1;
      }
    }

    for (const raw of asArray(correction.findings)) {
      const entry = asRecord(raw);
      const findingId = asText(entry.finding_id);
      if (!findingId) continue;
      const replacement = {
        finding_id: findingId,
        claim: asText(entry.claim),
        category: asText(entry.category),
        importance: asLevel(entry.importance),
        label: LABELS.has(asText(entry.label)) ? asText(entry.label) : 'NEEDS_VERIFICATION',
        evidence: asArray(entry.evidence).map((item) => {
          const support = asRecord(item);
          return {
            source_id: asText(support.source_id),
            source_title: asText(support.source_title),
            source_url: asText(support.source_url),
            support: asText(support.support),
          };
        }),
        confidence: clamp01(asNumber(entry.confidence, 0)),
      };
      const index = merged.findings.findIndex((candidate) => candidate.finding_id === findingId);
      if (index >= 0) merged.findings[index] = replacement;
      else merged.findings.push(replacement);
    }

    asArray(correction.remaining_uncertainties).forEach((raw, index) => {
      const text = asText(raw);
      if (!text) return;
      merged.issues.push({
        issue_id: 'U' + round + '-' + (index + 1),
        target_agent: '',
        target_finding_id: '',
        problem: text,
        severity: 'medium',
        required_action:
          'Still unsettled after correction round ' + round + '. A person must establish this before ' +
          'the work that rests on it is relied on.',
      });
    });

    // Confidence may only rise on new evidence, and nothing on this island can
    // retrieve any — so on this deployment a correction can only ever lower it.
    const stated = clamp01(asNumber(correction.confidence, merged.confidence));
    const broughtEvidence = asArray(correction.sources).length > 0;
    merged.confidence = broughtEvidence ? stated : Math.min(merged.confidence, stated);
    merged.status = 'corrected';

    return { output: merged, resolved: resolved, unresolved: unresolved };
  }

  async function runCorrection(ctx, definition, issues, round) {
    const previous = ctx.outputs.get(definition.id);
    if (!previous) return;

    const request = {
      mission_id: ctx.mission.id,
      correction_required: true,
      issues: issues,
      retry_number: round,
      maximum_retries: CONFIG.maxCorrectionRounds,
    };

    emit(
      ctx,
      'correction_requested',
      definition.name + ' was sent ' + plural(issues.length, 'flagged finding') + ' to correct (round ' +
        round + ' of ' + CONFIG.maxCorrectionRounds + ').',
      { round: round, issues: issues },
      definition.id,
    );

    const attempted = await attemptAgent(ctx, definition, round, request);
    if (!attempted) {
      emit(
        ctx,
        'log',
        definition.name + ' could not run its correction round, so the findings flagged against it stay ' +
          'unresolved and are carried into the report as they are.',
        { round: round, issues: issues.length },
        definition.id,
      );
      return;
    }

    const merge = mergeCorrection(ctx, definition, previous, attempted.output, issues, round);

    // The merged output is what the rest of the mission reads, so it is the one
    // stored on the correction run — the original run keeps its original answer.
    finishRun(ctx, attempted.run, {
      status: 'completed',
      output: merge.output,
      confidence: merge.output.confidence,
      repairs: attempted.repairs,
      answerChars: attempted.answerChars,
    });

    ctx.outputs.set(definition.id, merge.output);
    registerOrigins(ctx, definition.id, merge.output);

    emit(
      ctx,
      'correction_applied',
      definition.name + ' came back from round ' + round + ' with ' + plural(merge.resolved, 'issue') +
        ' resolved and ' + merge.unresolved + ' still open.',
      { round: round, resolved: merge.resolved, unresolved: merge.unresolved, confidence: merge.output.confidence },
      definition.id,
    );
  }

  /**
   * Holds the mission at the gate until verification passes or the rounds run
   * out. Past the cap the flagged findings are neither dropped nor quietly
   * marked fine: they stay unresolved, which is exactly where the final report
   * reads its unresolved-issues section from.
   */
  async function runVerificationGate(ctx) {
    if (!ctx.selected.includes('risk_verification')) return;

    for (let round = 0; ; round += 1) {
      const output = ctx.outputs.get('risk_verification');
      if (!output) return;

      const reading = readGate(output);
      persistGate(ctx, reading, round);
      if (reading.passed) return;

      if (round >= CONFIG.maxCorrectionRounds) {
        emit(
          ctx,
          'log',
          'The verification gate still did not pass after ' + plural(round, 'correction round') + '. ' +
            plural(reading.flags.length, 'finding') + ' are carried into the report as unresolved rather ' +
            'than recorded as settled.',
          { round: round, unresolved: reading.flags.length },
          'risk_verification',
        );
        return;
      }

      const routed = routeFlags(ctx, reading.flags, round + 1);
      if (routed.unroutable.length > 0) {
        emit(
          ctx,
          'log',
          plural(routed.unroutable.length, 'flagged finding') + ' name no agent that ran on this mission, ' +
            'so there is nobody to send them back to. They stay unresolved.',
          { findings: routed.unroutable.map((flag) => flag.findingId) },
          'risk_verification',
        );
      }
      if (routed.byAgent.size === 0) return;

      const nextRound = round + 1;
      await runPool(Array.from(routed.byAgent.entries()), CONFIG.maxConcurrentAgents, async (entry) => {
        await gate(ctx.handle);
        await runCorrection(ctx, requireAgent(entry[0]), entry[1], nextRound);
      });

      await gate(ctx.handle);
      const rechecked = await runStandardAgent(ctx, requireAgent('risk_verification'), nextRound);
      if (!rechecked) {
        emit(
          ctx,
          'log',
          'The verification agent could not re-check the corrected work, so everything it flagged stays ' +
            'unresolved in the report.',
          { round: nextRound },
          'risk_verification',
        );
        return;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // The plan the Task Manager hands down
  // ---------------------------------------------------------------------------

  function readPlan(ctx) {
    const output = ctx.outputs.get('task_manager');
    if (!output) return;

    const definition = asRecord(output.task_definition);
    ctx.plan.objective = asText(definition.objective);
    ctx.plan.constraints = textList(definition.constraints);

    ctx.plan.questions = asArray(output.research_questions)
      .map((raw, index) => {
        const entry = asRecord(raw);
        return {
          question_id: asText(entry.question_id) || 'Q' + String(index + 1).padStart(3, '0'),
          question: asText(entry.question),
          priority: asLevel(entry.priority),
        };
      })
      .filter((question) => question.question);

    for (const raw of asArray(output.required_agents)) {
      const entry = asRecord(raw);
      const id = asText(entry.agent_id);
      if (!id || !getAgent(id)) continue;
      ctx.plan.agents.add(id);
      const reason = asText(entry.reason);
      if (reason) ctx.plan.reasons.set(id, reason);
    }

    for (const raw of asArray(output.execution_order)) {
      const id = asText(raw);
      if (id && getAgent(id)) ctx.plan.agents.add(id);
    }
  }

  /**
   * Narrows the roster to what the plan actually needs.
   *
   * Two things the plan is not allowed to do: add back an agent the user
   * switched off, and drop the two agents that keep the rest of the mission
   * honest. A plan that named nothing usable is ignored rather than obeyed into
   * an empty mission.
   */
  function narrowRoster(ctx, roster) {
    const runnable = roster.filter((id) => id !== 'task_manager');
    if (ctx.plan.agents.size === 0) return runnable;

    const selected = runnable.filter((id) => ctx.plan.agents.has(id) || ALWAYS_KEEP.has(id));
    if (selected.length === 0) return runnable;

    for (const id of runnable) {
      if (selected.includes(id)) continue;
      emit(
        ctx,
        'agent_skipped',
        requireAgent(id).name + ' was left out: the Task Manager’s plan does not need it for this mission.',
        { reason: 'not_in_plan' },
        id,
      );
    }
    return selected;
  }

  // ---------------------------------------------------------------------------
  // The final report, ported from report.ts
  //
  // Everything here is assembled from what is already on record. Nothing in it
  // writes a sentence the mission did not earn: a section whose agent never ran
  // says so in as many words, a figure nobody estimated stays zero with a note
  // attached, and an issue nobody resolved is printed as unresolved rather than
  // dropped on the way to a tidier document.
  // ---------------------------------------------------------------------------

  function missingAgent(agentId) {
    return 'No ' + agentId.replace(/_/g, ' ') + ' agent ran on this mission.';
  }

  function topClaims(output, limit) {
    return output.findings
      .filter((finding) => finding.importance === 'high')
      .slice(0, limit)
      .map((finding) => finding.claim + ' (' + finding.label + ', confidence ' + percent(finding.confidence) + ')');
  }

  function researchSummary(output) {
    if (!output) return missingAgent('research');
    const claims = topClaims(output, 3);
    const gaps = textList(output.information_gaps);
    const parts = [
      'The research agent recorded ' + plural(output.findings.length, 'finding') + ' from training data ' +
        'alone, at an overall confidence of ' + percent(output.confidence) + '.',
    ];
    if (claims.length) parts.push('Its highest-importance findings: ' + claims.join(' '));
    parts.push(
      gaps.length
        ? 'It could not establish: ' + gaps.join('; ') + '.'
        : 'It reported no outstanding information gaps — which, with no way to search, is itself worth a ' +
          'second look.',
    );
    return parts.join(' ');
  }

  function competitorSummary(output) {
    if (!output) return missingAgent('competitor');
    const competitors = asArray(output.competitors).map(asRecord);
    const names = competitors.map((entry) => asText(entry.name)).filter(Boolean);
    const gaps = asArray(output.market_gaps).length;
    const challenged = asArray(output.previous_claims_challenged).length;

    if (competitors.length === 0) {
      return (
        'The competitor agent named no competitors. That is recorded as a finding in its own right, not ' +
        'as evidence of an empty market — an unsearchable market and an empty one look identical from here.'
      );
    }

    const listed = names.slice(0, 8).join(', ');
    return (
      'The competitor agent named ' + plural(names.length, 'competitor') +
      (listed ? ' — ' + listed + (names.length > 8 ? ', among others' : '') : '') + ' and identified ' +
      plural(gaps, 'market gap') + '. It challenged ' + plural(challenged, 'earlier claim') + '. Every name ' +
      'here is recalled, not looked up: check that each company still exists and still does this.'
    );
  }

  function marketSummary(output) {
    if (!output) return missingAgent('market_analysis');
    const assessment = asRecord(output.market_assessment);
    const segments = asArray(output.customer_segments).length;
    const threats = textList(output.threats);

    const parts = [
      'Market size: ' + sentence(asText(assessment.market_size) || 'not established') + ' Growth ' +
        (asText(assessment.growth_potential) || 'unknown') + ', demand ' +
        (asText(assessment.demand_level) || 'unknown') + ', competition ' +
        (asText(assessment.competition_level) || 'unknown') + '.',
      'It described ' + plural(segments, 'customer segment') + '.',
    ];
    if (threats.length) parts.push('Threats it named: ' + threats.slice(0, 5).join('; ') + '.');
    return parts.join(' ');
  }

  function analysisSummary(output) {
    if (!output) return missingAgent('analysis');
    const direction = asText(output.recommended_direction);
    const insights = textList(output.key_insights);
    const unsupported = asArray(output.unsupported_assumptions).length;

    const parts = [];
    if (direction) parts.push(direction);
    if (insights.length) parts.push('Key insights: ' + insights.slice(0, 5).join('; ') + '.');
    parts.push('It flagged ' + plural(unsupported, 'assumption') + ' that earlier work was carrying as established.');
    return parts.join(' ');
  }

  function strategySummary(output) {
    if (!output) return missingAgent('strategy');
    const recommendation = asRecord(output.recommendation);
    const actions = asArray(output.strategy).map((raw) => asText(asRecord(raw).action)).filter(Boolean);
    const stops = textList(output.stop_conditions);

    const parts = [asText(recommendation.reason) || 'The strategy agent gave no reasoning for its call.'];
    if (actions.length) parts.push('Its plan starts with: ' + actions.slice(0, 4).join('; ') + '.');
    if (stops.length) parts.push('It would stop if: ' + stops.slice(0, 4).join('; ') + '.');
    return parts.join(' ');
  }

  function keyFindingsFrom(chief, outputs) {
    if (chief) {
      const listed = asArray(chief.key_findings)
        .map((raw) => {
          const entry = asRecord(raw);
          const label = asText(entry.label);
          return {
            finding: asText(entry.finding),
            evidence: textList(entry.evidence),
            label: LABELS.has(label) ? label : 'NEEDS_VERIFICATION',
            confidence: Math.min(CONFIG.confidenceCeiling, asNumber(entry.confidence, 0)),
          };
        })
        .filter((entry) => entry.finding);
      if (listed.length) return listed;
    }

    // Nobody drew the headline findings together, so they are taken straight
    // from the agents that made them rather than invented here.
    const collected = [];
    for (const [agent, output] of outputs) {
      for (const finding of output.findings) {
        if (finding.importance === 'high') collected.push({ agent: agent, finding: finding });
      }
    }
    return collected.slice(0, 12).map((entry) => ({
      // Attributed by the name the agent is known by everywhere else: an id is
      // a storage key and has no business closing a sentence a person reads.
      finding: entry.finding.claim + ' (' + agentName(entry.agent) + ')',
      evidence: [],
      label: entry.finding.label,
      confidence: entry.finding.confidence,
    }));
  }

  function financialSummaryFrom(chief, financial, currency) {
    if (chief) {
      const summary = asRecord(chief.financial_summary);
      return {
        estimated_startup_cost: asNumber(summary.estimated_startup_cost, 0),
        estimated_monthly_cost: asNumber(summary.estimated_monthly_cost, 0),
        estimated_monthly_revenue: asNumber(summary.estimated_monthly_revenue, 0),
        currency: asText(summary.currency) || currency,
        note:
          (asText(summary.note) || 'Every figure here is an estimate.') +
          ' No price, wage or rent below was looked up: they are recalled figures, and the ones that ' +
          'matter should be quoted properly before anyone commits money.',
      };
    }

    if (!financial) {
      return {
        estimated_startup_cost: 0,
        estimated_monthly_cost: 0,
        estimated_monthly_revenue: 0,
        currency: currency,
        note: missingAgent('financial') + ' These zeros are the absence of an estimate, not an estimate of zero.',
      };
    }

    const costs = asArray(financial.costs).map(asRecord);
    const startup = costs
      .filter((cost) => asText(cost.period) === 'one_off')
      .reduce((total, cost) => total + asNumber(cost.amount, 0), 0);
    const monthlyFromCosts = costs
      .filter((cost) => asText(cost.period) === 'monthly')
      .reduce((total, cost) => total + asNumber(cost.amount, 0), 0);
    const expected = asArray(financial.revenue_scenarios)
      .map(asRecord)
      .find((scenario) => asText(scenario.scenario) === 'expected');

    return {
      estimated_startup_cost: startup,
      estimated_monthly_cost: asNumber(expected && expected.monthly_cost, monthlyFromCosts),
      estimated_monthly_revenue: asNumber(expected && expected.monthly_revenue, 0),
      currency: currency,
      note:
        (asText(financial.estimate_notice) || 'Taken from the financial agent’s expected case.') +
        ' Nothing here was priced against a real quote.',
    };
  }

  function recommendationFrom(chief, strategy) {
    const chiefCall = asRecord(chief && chief.final_assessment);
    const chiefDecision = asText(chiefCall.decision);
    if (DECISIONS.has(chiefDecision)) {
      return { decision: chiefDecision, reason: asText(chiefCall.reason) };
    }

    const strategyCall = asRecord(strategy && strategy.recommendation);
    const strategyDecision = asText(strategyCall.decision);
    if (DECISIONS.has(strategyDecision)) {
      return {
        decision: strategyDecision,
        reason:
          missingAgent('chief_ai') + ' This is the strategy agent’s call, which nobody reviewed ' +
          'independently. ' + asText(strategyCall.reason),
      };
    }

    return {
      decision: 'more_research',
      reason:
        'Neither the chief_ai agent nor the strategy agent produced a decision on this mission, so the ' +
        'island has no recommendation to give. What is below is the work that did complete.',
    };
  }

  function actionPlanFrom(chief, strategy) {
    const source = chief ? asArray(chief.action_plan) : asArray(strategy && strategy.strategy);
    return source
      .map((raw) => {
        const entry = asRecord(raw);
        return {
          priority: Math.max(1, Math.round(asNumber(entry.priority, 1))),
          action: asText(entry.action),
          reason: asText(entry.reason),
        };
      })
      .filter((entry) => entry.action)
      .sort((a, b) => a.priority - b.priority);
  }

  /**
   * How much of the roster actually reported.
   *
   * An agent that fails, is blocked, or never gets its turn leaves a hole the
   * chief's summary cannot see: it reads the hand-offs it was given, notices
   * nothing missing, and closes at whatever figure it likes. A mission cannot
   * be more confident than the share of its own roster that reported, so the
   * share is computed here from the run rows and handed to the report as a
   * ceiling and as a note. Up to four of the absent are named, with a count for
   * the rest; an empty roster counts as fully covered, since there is nobody to
   * be missing.
   */
  function rosterCoverage(agentSummary) {
    if (agentSummary.length === 0) return { ratio: 1, absent: [], named: '' };
    const absent = agentSummary
      .filter((entry) => entry.status !== 'completed')
      .map((entry) => ({ name: entry.name, status: entry.status }));
    const shown = absent
      .slice(0, 4)
      .map((entry) => entry.name + ' (' + entry.status + ')')
      .join(', ');
    const rest = absent.length > 4 ? ' and ' + (absent.length - 4) + ' more' : '';
    return {
      ratio: (agentSummary.length - absent.length) / agentSummary.length,
      absent: absent,
      named: shown + rest,
    };
  }

  function buildFinalReport(ctx) {
    const mission = ctx.mission;
    const outputs = ctx.outputs;
    const chief = outputs.get('chief_ai');
    const strategy = outputs.get('strategy');
    const verifier = outputs.get('risk_verification');
    const verificationSummary = asRecord(verifier && verifier.verification_summary);

    const latest = new Map();
    for (const run of ctx.runs) {
      const current = latest.get(run.agentId);
      if (!current || run.status === 'completed' || current.status !== 'completed') latest.set(run.agentId, run);
    }

    const unresolvedIssues = ctx.verifications
      .filter((record) => !record.resolved && record.status !== 'checked')
      .map((record) => ({
        issue_id: record.id,
        agent: record.agentId,
        finding_id: record.findingId,
        problem: record.reason,
        severity: record.severity,
        required_action: record.recommendedAction,
      }));

    const completed = Array.from(outputs.values());
    const assumptions = unique(completed.reduce((all, output) => all.concat(output.assumptions), []));

    const unresolvedQuestions = unique(
      (chief ? textList(chief.unknowns) : [])
        .concat(verifier ? textList(verifier.required_research) : [])
        .concat(chief ? [] : [missingAgent('chief_ai') + ' Nothing in this report was reviewed independently.'])
        .concat(verifier ? [] : [missingAgent('risk_verification') + ' No claim here has been checked by anyone.']),
    );

    const majorRisks = unique(
      chief
        ? textList(chief.major_risks)
        : (strategy ? textList(strategy.key_risks) : [])
            .concat(outputs.get('financial') ? textList(outputs.get('financial').financial_risks) : [])
            .concat(unresolvedIssues.filter((issue) => issue.severity === 'high').map((issue) => issue.problem)),
    );

    const derivedConfidence = completed.length
      ? completed.reduce((total, output) => total + output.confidence, 0) / completed.length
      : 0;
    const statedConfidence = clamp01(
      chief ? asNumber(chief.overall_confidence, derivedConfidence) : derivedConfidence,
    );

    // Every place assembly had to overrule what the mission said about itself
    // because the record did not support it. Printed in the report rather than
    // applied quietly: a correction the reader cannot see is just a different
    // agent's word for it, and the point of holding the report to the record is
    // that the reader no longer has to take anyone's word. Always present on
    // the report, and empty when there was nothing to say.
    const integrityNotes = [];

    const chiefContributions = new Map();
    for (const raw of asArray(chief && chief.agent_summary)) {
      const entry = asRecord(raw);
      const agent = asText(entry.agent);
      if (agent) chiefContributions.set(agent, asText(entry.key_contribution));
    }

    const involved = AGENTS.map((agent) => agent.id).filter(
      (id) => latest.has(id) || mission.enabledAgents.includes(id),
    );

    const agentSummary = involved.map((agentId) => {
      const run = latest.get(agentId);
      const output = outputs.get(agentId);
      let contribution = chiefContributions.get(agentId) || '';
      if (!contribution) {
        if (!run) contribution = 'Enabled for this mission but never ran.';
        else if (run.status !== 'completed') contribution = run.error || 'Did not finish.';
        else if (output) {
          contribution =
            plural(output.findings.length, 'finding') + ', ' + plural(output.issues.length, 'issue') +
            ' raised, confidence ' + percent(output.confidence) + '.';
        }
      }
      return {
        agent: agentId,
        name: agentName(agentId),
        status: run ? run.status : 'skipped',
        key_contribution: contribution,
      };
    });

    // --- the roster ceiling ---------------------------------------------------
    // Everything above this line is what the mission said about itself. This is
    // where the record gets to answer back. It is said whether or not it changes
    // a number: a mission missing a third of its roster is a fact about the
    // record, and a reader who is only told when the confidence also happened to
    // need capping learns it by coincidence.
    const coverage = rosterCoverage(agentSummary);
    if (coverage.absent.length > 0) {
      integrityNotes.push(
        plural(coverage.absent.length, 'agent') + ' on this mission never reported: ' + coverage.named +
          '. Nothing below rests on work they would have done, and the overall confidence is held to ' +
          'at most ' + percent(coverage.ratio) + ' for that reason.',
      );
    }

    // The retrieval ceiling applies to the report as it applies to every claim
    // inside it: an unretrieved mission cannot hand back a confident answer. The
    // roster ceiling composes with it rather than replacing it — the lower of
    // the two wins — and only the roster's is written up as a note here, because
    // the retrieval ceiling is already explained in full in the confidence
    // explanation below.
    let overallConfidence = Math.min(CONFIG.confidenceCeiling, statedConfidence);
    if (coverage.absent.length > 0 && coverage.ratio < overallConfidence) {
      integrityNotes.push(
        'The overall confidence was given as ' + percent(statedConfidence) + ', but only ' +
          percent(coverage.ratio) + ' of this mission’s roster reported at all, so the work behind it is ' +
          'incomplete and it is shown as ' + percent(coverage.ratio) + '.',
      );
      overallConfidence = coverage.ratio;
    }

    const checkedForConsistency = ctx.verifications.filter((record) => record.status === 'checked').length;
    const verificationRounds = ctx.runs.filter(
      (run) => run.agentId === 'risk_verification' && run.status === 'completed',
    ).length;

    return {
      mission_id: mission.id,
      mission_reference: mission.reference,
      generated_at: nowIso(),
      engine: mission.engine,
      original_task: mission.userTask,
      executive_summary: chief ? asText(chief.executive_summary) || missingAgent('chief_ai') : missingAgent('chief_ai'),
      key_findings: keyFindingsFrom(chief, outputs),
      research_summary: researchSummary(outputs.get('research')),
      competitor_summary: competitorSummary(outputs.get('competitor')),
      market_summary: marketSummary(outputs.get('market_analysis')),
      analysis_summary: analysisSummary(outputs.get('analysis')),
      financial_summary: financialSummaryFrom(chief, outputs.get('financial'), mission.currency),
      major_risks: majorRisks,
      verification: {
        total_claims_reviewed: Math.round(asNumber(verificationSummary.total_claims_reviewed, 0)),
        // Nothing was retrieved, so nothing is verified. What the gate could do
        // is check the mission against itself, and that is counted separately.
        verified: 0,
        checked_for_consistency: checkedForConsistency,
        needs_verification: Math.round(asNumber(verificationSummary.needs_verification, 0)),
        contradictions: ctx.verifications.filter((record) => record.status === 'contradiction').length,
        high_risk_items: ctx.verifications.filter((record) => record.status === 'high_risk').length,
        rounds_used: verificationRounds,
        passed: verifier ? verifier.verification_passed === true : false,
      },
      strategy_summary: strategySummary(strategy),
      recommendation: recommendationFrom(chief, strategy),
      action_plan: actionPlanFrom(chief, strategy),
      assumptions: assumptions,
      unresolved_questions: unresolvedQuestions,
      unresolved_issues: unresolvedIssues,
      corrections: ctx.corrections,
      // Empty, and not because nobody looked: there is nothing here that could
      // have been retrieved, and a citation the reader cannot open is worse
      // than an honest blank.
      sources: [],
      overall_confidence: overallConfidence,
      confidence_explanation:
        (chief ? asText(chief.confidence_explanation) + ' ' : '') +
        'Capped at ' + CONFIG.confidenceCeiling + ' by the engine: this mission ran with no web access, ' +
        'no search and no connected data, so not one claim in it was checked against a source. ' +
        (ctx.honesty.labels || ctx.honesty.confidences || ctx.honesty.citations
          ? 'The engine also had to rewrite ' + plural(ctx.honesty.labels, 'VERIFIED label') + ', clamp ' +
            plural(ctx.honesty.confidences, 'confidence figure') + ' and drop ' +
            plural(ctx.honesty.citations, 'citation') + ' that the agents wrote as if they had looked ' +
            'things up.'
          : 'The agents kept to that on their own; the engine had nothing to rewrite.'),
      agent_summary: agentSummary,
      retrieval: 'none',
      retrieval_notice: NO_RETRIEVAL_NOTICE,
      simulation_notice: '',
      integrity_notes: integrityNotes,
    };
  }

  // ---------------------------------------------------------------------------
  // The mission loop
  //
  // Every path out of here ends in completed, failed or aborted, and each of
  // them says why in an event. A mission the loop drops without writing a
  // terminal status is a mission the page animates for ever with nothing behind
  // it, which is the one failure this file is shaped to make impossible.
  // ---------------------------------------------------------------------------

  function closeOpenRuns(ctx, reason) {
    for (const run of ctx.runs) {
      if (run.completedAt) continue;
      finishRun(ctx, run, { status: 'failed', error: reason });
    }
  }

  async function runMission(ctx) {
    const handle = ctx.handle;
    const mission = ctx.mission;

    try {
      updateMission(ctx, {
        status: 'planning',
        startedAt: nowIso(),
        currentStage: 'plan',
        error: null,
      });
      emit(ctx, 'mission_started', 'Mission ' + mission.reference + ' started.', {
        engine: mission.engine,
        mode: mission.mode,
      });
      // The banner is on screen, but the timeline is what survives a reload and
      // what anyone reading this mission later actually scrolls through.
      emit(ctx, 'log', NO_RETRIEVAL_NOTICE, { retrieval: 'none' });

      const roster = mission.enabledAgents.filter((id) => getAgent(id) !== undefined);
      if (roster.length === 0) {
        throw new Error('This mission has no island agents enabled, so there is nothing to run.');
      }

      // Everything an agent does happens inside this inner try. Claude going
      // away part-way through — the page's grant revoked, the session expired, a
      // rate limit that a back-off did not clear — ends the agents, and it ends
      // them here rather than unwinding to the outer catch, because that catch
      // stores a failure with no report, and a mission whose model walked out on
      // it still has a record: every run row written so far, every error, and
      // now a row for each agent that never got its turn. Nothing is retried
      // past this point. An abort is not a fatal, whatever else was in flight
      // when it landed, and keeps its own branch in the outer catch.
      let fatal = null;
      try {
        let stageRan = false;
        if (roster.includes('task_manager')) {
          emit(ctx, 'stage_started', STAGE_LABEL.plan + ' started.', { stage: 'plan' });
          await gate(handle);
          await runStandardAgent(ctx, requireAgent('task_manager'), 0);
          readPlan(ctx);
          stageRan = true;
        }

        ctx.selected = narrowRoster(ctx, roster);
        updateMission(ctx, { status: 'running' });

        for (const stage of STAGE_ORDER) {
          if (stage === 'plan') continue;
          const inStage = ctx.selected.filter((id) => requireAgent(id).stage === stage);
          if (inStage.length === 0) continue;

          await gate(handle);
          if (stageRan) await awaitApproval(ctx, stage);
          stageRan = true;
          updateMission(ctx, { status: 'running', currentStage: stage, pendingApprovalStage: null });
          emit(ctx, 'stage_started', STAGE_LABEL[stage] + ' started with ' + plural(inStage.length, 'agent') + '.', {
            stage: stage,
            agents: inStage,
          });

          for (const wave of planWaves(inStage)) {
            for (const agentId of wave) {
              emit(ctx, 'agent_queued', requireAgent(agentId).name + ' is queued.', { stage: stage }, agentId);
            }
            await runPool(wave, CONFIG.maxConcurrentAgents, async (agentId) => {
              await gate(handle);
              const definition = requireAgent(agentId);
              const missing = definition.dependsOn.filter(
                (dependency) => ctx.selected.includes(dependency) && !ctx.outputs.has(dependency),
              );
              if (missing.length > 0) {
                markBlocked(ctx, definition, missing);
                return;
              }
              await runStandardAgent(ctx, definition, 0);
            });
          }

          if (stage === 'verify') await runVerificationGate(ctx);
        }
      } catch (error) {
        const isFatal = Boolean(error && error.fatal);
        if (!isFatal || (error && error.aborted) || handle.controller.signal.aborted) throw error;
        fatal = error;
        emit(
          ctx,
          'log',
          'Claude went away before the mission finished, so no further agent will run. What completed ' +
            'is kept, what did not is recorded as such, and the report is assembled from that.',
          { code: fatal.code || '' },
        );
        // Before the Task Manager has narrowed the roster there is no selection
        // yet, and the agents that would have run are the whole enabled roster.
        markModelUnavailable(ctx, ctx.selected.length ? ctx.selected : roster, fatal);
      }

      // Assembly runs whatever happened above, on whatever the record holds. A
      // mission nothing came back from — usually the model service being
      // unreachable for the whole run — has failed and is recorded as failed;
      // what it must not do is vanish. Every attempt and every error is already
      // in the record, and that record is the report. Assembly writes it the
      // same way it writes any other one: no agent output to draw on means no
      // findings, no decision beyond "more research required", and a confidence
      // of zero, each of those arrived at by reading empty rows rather than by
      // anything here composing a stand-in for the work that did not happen.
      const report = buildFinalReport(ctx);
      saveReport(mission.id, report);

      if (fatal || ctx.outputs.size === 0) {
        // A mission the model walked out of is a failed mission that still
        // hands back its record, and so is one where every agent failed on its
        // own. Whichever it was, the report is stored with it.
        const reason = fatal
          ? fatal.message
          : 'Every agent on this mission failed, so it has no findings of its own to report.';
        updateMission(ctx, {
          status: 'failed',
          error: reason,
          finalReport: report,
          decision: report.recommendation.decision,
          confidence: report.overall_confidence,
          currentStage: null,
          pendingApprovalStage: null,
          completedAt: nowIso(),
        });
        emit(
          ctx,
          'mission_failed',
          'Mission ' + mission.reference + ' failed: ' + reason + ' ' +
            (ctx.outputs.size === 0
              ? 'The report below is the record of what was attempted, and contains no conclusions.'
              : 'The report below is the record of what was attempted: it holds the work of the ' +
                plural(ctx.outputs.size, 'agent') + ' that completed, and nothing from the ' +
                plural(ctx.failed.size, 'agent') + ' that did not.'),
          {
            code: fatal ? fatal.code || '' : '',
            agents_completed: ctx.outputs.size,
            agents_failed: ctx.failed.size,
            findings: report.key_findings.length,
          },
        );
      } else {
        updateMission(ctx, {
          status: 'completed',
          finalReport: report,
          decision: report.recommendation.decision,
          confidence: report.overall_confidence,
          currentStage: null,
          pendingApprovalStage: null,
          completedAt: nowIso(),
          error: null,
        });
        emit(
          ctx,
          'mission_completed',
          'Mission ' + mission.reference + ' finished: ' + report.recommendation.decision.replace(/_/g, ' ') +
            ' at ' + percent(report.overall_confidence) + ' confidence, none of it retrieved.',
          {
            decision: report.recommendation.decision,
            confidence: report.overall_confidence,
            unresolved: report.unresolved_issues.length,
          },
        );
      }
    } catch (error) {
      const aborted = (error && error.aborted) || handle.controller.signal.aborted;
      if (aborted) {
        if (!handle.settled) {
          updateMission(ctx, {
            status: 'aborted',
            currentStage: null,
            pendingApprovalStage: null,
            completedAt: nowIso(),
          });
          emit(
            ctx,
            'mission_aborted',
            'Mission aborted. Nothing further will run and the work recorded so far is kept.',
            {},
          );
        }
      } else {
        const message = error && error.message ? error.message : String(error);
        updateMission(ctx, {
          status: 'failed',
          error: message,
          currentStage: null,
          pendingApprovalStage: null,
          completedAt: nowIso(),
        });
        emit(ctx, 'mission_failed', 'Mission ' + mission.reference + ' failed: ' + message, {
          code: (error && error.code) || '',
        });
      }
    } finally {
      handle.settled = true;
      active.delete(mission.id);
      // Whatever happened above, no run row is left open: an agent row with no
      // completedAt is the same lie at agent level that a running mission with
      // no loop is at mission level.
      closeOpenRuns(ctx, 'The mission ended before this agent finished.');
      saveMission(ctx.mission);
      // Awaited, so a caller that renders the moment this resolves reads a
      // store that already has the last event in it.
      await flushEvents(ctx);
    }

    return clone(ctx.mission);
  }

  // ---------------------------------------------------------------------------
  // Control surface
  // ---------------------------------------------------------------------------

  const DEFAULT_ROSTER = AGENTS.filter((agent) => agent.enabledByDefault).map((agent) => agent.id);

  /** The page's form and the engine's own record spell three of these
   *  differently, so both spellings are accepted rather than one of them
   *  silently producing a mission with no task. */
  async function createMission(input) {
    const source = asRecord(input);
    const userTask = asText(source.userTask) || asText(source.task);
    if (!userTask) throw new Error('A mission needs a task: say what you want the island to work on.');

    const listed = asArray(source.enabledAgents).length ? source.enabledAgents : source.agents;
    const requested = asArray(listed)
      .map(asText)
      .filter((id) => getAgent(id) !== undefined);
    const enabledAgents = requested.length ? requested : DEFAULT_ROSTER.slice();
    const sample = await useSample();

    const mission = {
      id: newId('msn'),
      reference: await nextReference(),
      userTask: userTask,
      objective: asText(source.objective),
      geography: asText(source.geography),
      language: asText(source.language) || 'English',
      currency: asText(source.currency) || 'USD',
      constraints: textList(source.constraints),
      userRequirements: textList(source.userRequirements),
      status: 'created',
      mode: asText(source.mode) === 'approval' ? 'approval' : 'auto',
      engine: sample ? 'claude' : 'unavailable',
      /** No agent here can retrieve anything. Recorded on the mission so a
       *  report can never be read later as if it had been researched. */
      retrieval: 'none',
      enabledAgents: enabledAgents,
      currentStage: null,
      pendingApprovalStage: null,
      decision: null,
      confidence: null,
      finalReport: null,
      error: null,
      createdBy: asText(source.createdBy),
      createdByName: asText(source.createdByName),
      createdAt: nowIso(),
      heartbeatAt: nowIso(),
      startedAt: null,
      completedAt: null,
    };

    const created = {
      id: newId('evt'),
      missionId: mission.id,
      seq: 1,
      type: 'mission_created',
      agentId: null,
      payload: { agents: enabledAgents },
      message:
        'Mission ' + mission.reference + ' created with ' + plural(enabledAgents.length, 'agent') +
        ' enabled. Nothing on this island can search the web, so every claim it produces is a starting ' +
        'point to check.',
      createdAt: nowIso(),
    };

    saveMission(mission);
    saveEvents(mission.id, [created], mission.heartbeatAt);
    return clone(mission);
  }

  /**
   * Two ways in, because the page and the engine were written alongside each
   * other:
   *   startMission(missionId, handlers) — run a mission `createMission` already
   *     made, resolving when it reaches a terminal state;
   *   startMission({task, ...}, handlers) — create one from the page's form and
   *     start it, resolving as soon as it is under way with the package the UI
   *     opens. A mission takes minutes, so this one cannot wait for the end.
   */
  function startMission(target, handlers) {
    if (target && typeof target === 'object') return createAndStart(target, handlers);
    return runMissionById(target, handlers);
  }

  async function createAndStart(input, handlers) {
    const mission = await createMission(input);
    // Deliberately not awaited: the caller opens the mission now and watches it
    // through events, exactly as the repo's fire-and-forget start does.
    runMissionById(mission.id, handlers).catch((error) => {
      console.error('[island] mission loop escaped its own error handling', error);
    });
    return {
      mission: mission,
      runs: [],
      events: clone(memory.events.get(mission.id) || []),
      corrections: [],
      verifications: [],
    };
  }

  async function runMissionById(missionId, handlers) {
    if (active.has(missionId)) throw new Error('This mission is already running.');

    const loaded = await loadMission(missionId);
    if (!loaded) throw new Error('Mission not found.');
    if (loaded.mission.status !== 'created') {
      throw new Error('This mission has already been started. Create a new one to run the work again.');
    }

    const sample = await useSample();
    if (!sample) {
      // Degrading rather than throwing: the page asked to run something it
      // cannot run, and the mission record has to say so rather than vanish.
      const reason =
        'This page cannot reach Claude, so no agent can run. Open the artifact in Claude and allow it to ' +
        'use Claude on your account, then start a new mission.';
      const failed = Object.assign({}, loaded.mission, {
        status: 'failed',
        error: reason,
        completedAt: nowIso(),
      });
      saveMission(failed);
      if (handlers && typeof handlers.onMission === 'function') handlers.onMission(clone(failed));
      return clone(failed);
    }

    const handle = {
      controller: new AbortController(),
      paused: false,
      resumeResolver: null,
      approvalResolver: null,
      settled: false,
    };

    const ctx = {
      mission: loaded.mission,
      handlers: asRecord(handlers),
      handle: handle,
      events: loaded.events.slice(),
      runs: [],
      outputs: new Map(),
      order: [],
      origins: new Map(),
      claimOrigins: new Map(),
      plan: { objective: '', constraints: [], questions: [], agents: new Set(), reasons: new Map() },
      failed: new Set(),
      selected: [],
      corrections: [],
      verifications: [],
      honesty: { labels: 0, confidences: 0, citations: 0 },
      nextSeq: loaded.events.length + 1,
      flushTimer: null,
    };

    handle.ctx = ctx;
    active.set(missionId, handle);
    notify(ctx, 'onMission', ctx.mission);

    // Held on the handle so a delete can wait for the loop to stop writing.
    handle.done = runMission(ctx);
    return handle.done;
  }

  async function pauseMission(missionId) {
    const handle = active.get(missionId);
    if (!handle) throw new Error('Nothing is running this mission, so there is nothing to pause.');
    const ctx = handle.ctx;
    if (handle.paused) return clone(ctx.mission);

    handle.paused = true;
    updateMission(ctx, { status: 'paused' });
    emit(
      ctx,
      'mission_paused',
      'Mission paused. The agent already working will finish what it is doing, and nothing new will start ' +
        'until you resume.',
      {},
    );
    flushEvents(ctx);
    return clone(ctx.mission);
  }

  async function resumeMission(missionId) {
    const handle = active.get(missionId);
    if (!handle) {
      const loaded = await loadMission(missionId);
      if (!loaded) throw new Error('Mission not found.');
      // Nothing is behind this mission any more, and saying so is the only
      // honest answer: the loop lived in a tab that has gone.
      return TERMINAL.has(loaded.mission.status) ? loaded.mission : strandedMission(loaded.mission);
    }

    const ctx = handle.ctx;
    if (!handle.paused) return clone(ctx.mission);

    handle.paused = false;
    updateMission(ctx, { status: 'running' });
    emit(ctx, 'mission_resumed', 'Mission resumed.', {});
    if (handle.resumeResolver) handle.resumeResolver();
    return clone(ctx.mission);
  }

  async function abortMission(missionId) {
    const handle = active.get(missionId);
    const message = 'Mission aborted. Nothing further will run and the work recorded so far is kept.';

    if (!handle) {
      const loaded = await loadMission(missionId);
      if (!loaded) throw new Error('Mission not found.');
      if (TERMINAL.has(loaded.mission.status)) return loaded.mission;
      const aborted = Object.assign({}, loaded.mission, {
        status: 'aborted',
        currentStage: null,
        completedAt: nowIso(),
      });
      saveMission(aborted);
      return aborted;
    }

    const ctx = handle.ctx;
    // Marked settled before the abort lands so the loop does not write a second
    // terminal state over this one.
    handle.settled = true;
    handle.paused = false;
    updateMission(ctx, { status: 'aborted', currentStage: null, completedAt: nowIso() });
    emit(ctx, 'mission_aborted', message, {});
    // The signal reaches `sample`, so an agent mid-call stops writing — and the
    // viewer stops paying for the rest of an answer nobody will read.
    handle.controller.abort();
    if (handle.resumeResolver) handle.resumeResolver();
    flushEvents(ctx);
    return clone(ctx.mission);
  }

  async function approveStage(missionId, note) {
    const handle = active.get(missionId);
    if (!handle) {
      const loaded = await loadMission(missionId);
      if (!loaded) throw new Error('Mission not found.');
      return TERMINAL.has(loaded.mission.status) ? loaded.mission : strandedMission(loaded.mission);
    }

    const ctx = handle.ctx;
    if (ctx.mission.status !== 'awaiting_approval') return clone(ctx.mission);

    const stage = ctx.mission.pendingApprovalStage;
    updateMission(ctx, { status: 'running', pendingApprovalStage: null });
    emit(
      ctx,
      'approval_granted',
      stage
        ? 'The ' + STAGE_LABEL[stage] + ' stage was approved and starts now.'
        : 'The next stage was approved and starts now.',
      { stage: stage, note: asText(note) },
    );
    if (handle.approvalResolver) handle.approvalResolver();
    return clone(ctx.mission);
  }

  function isRunning(missionId) {
    return active.has(missionId);
  }

  return {
    createMission: createMission,
    startMission: startMission,
    pauseMission: pauseMission,
    resumeMission: resumeMission,
    abortMission: abortMission,
    approveStage: approveStage,
    listMissions: listMissions,
    loadMission: loadMission,
    getMission: loadMission,
    deleteMission: deleteMission,
    isAvailable: isAvailable,
    // The page asks for the capability answer under this name; same function.
    init: isAvailable,
    onEvent: onEvent,
    isRunning: isRunning,
    STAGE_ORDER: STAGE_ORDER,
    STAGE_LABEL: STAGE_LABEL,
    CONFIDENCE_CEILING: CONFIG.confidenceCeiling,
    NO_RETRIEVAL_NOTICE: NO_RETRIEVAL_NOTICE,
  };
})();

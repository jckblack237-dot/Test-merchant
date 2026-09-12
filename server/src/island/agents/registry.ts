/**
 * The island roster: who lives here, what they depend on, and where their hut
 * sits on the map.
 *
 * `dependsOn` is the real execution graph — the orchestrator plans waves from
 * it, so a wrong edge here silently changes what every agent gets to read. The
 * map coordinates are laid out so the mission reads west to east: the Task
 * Manager on the west shore, the gathering agents along the north coast, the
 * quantifying and strategy work down on the south side, and the Chief AI in its
 * headquarters on the eastern point. Huts are kept at least twelve units apart
 * so their labels do not collide at any zoom level.
 */
// A type-only import: pulling the runtime module in here would make the
// database module and the roster require each other at load time, and the
// roster is seeded from db/index.ts the same way the plan catalogue is.
import type { Db } from '../../db';
import type { TenantStore } from '../../db/tenant';
import { badRequest } from '../../lib/errors';
import { newId } from '../../lib/ids';
import { nowIso } from '../../lib/time';
import { SCHEMAS_BY_AGENT, SPECIALIST_SCHEMA } from '../schemas';
import type { AgentDefinition, JsonSchema, Stage } from '../types';
import { PROMPTS } from './prompts';

interface AgentSpec {
  id: string;
  name: string;
  emoji: string;
  role: string;
  summary: string;
  stage: Stage;
  dependsOn: string[];
  core: boolean;
  webSearch?: boolean;
  needsMarketData?: boolean;
  x: number;
  y: number;
}

/**
 * The schema an agent actually runs on.
 *
 * A hand-written schema wins wherever one exists. `core` says whether an agent
 * is on by default, which has nothing to do with whether anyone wrote it a
 * contract: the forex desk is opt-in and has three of the most specific schemas
 * in the file. Reading `core` here instead of the map is how those three came
 * to be unreachable, with prompts describing fields the model was never offered
 * and `stripUnknown` deleting them if it guessed right anyway.
 *
 * The generic specialist shape is the fallback for an agent nobody has written
 * one for. A core agent without one is a build mistake rather than something to
 * paper over at runtime.
 */
function schemaFor(id: string, core: boolean): JsonSchema {
  const schema = SCHEMAS_BY_AGENT[id];
  if (schema) return schema;
  if (core) throw new Error(`Core agent "${id}" has no entry in SCHEMAS_BY_AGENT.`);
  return SPECIALIST_SCHEMA(id);
}

function promptFor(id: string): string {
  const systemPrompt = PROMPTS[id];
  if (!systemPrompt) throw new Error(`Agent "${id}" has no entry in PROMPTS.`);
  return systemPrompt;
}

function define(spec: AgentSpec): AgentDefinition {
  return {
    id: spec.id,
    name: spec.name,
    emoji: spec.emoji,
    role: spec.role,
    stage: spec.stage,
    dependsOn: spec.dependsOn,
    core: spec.core,
    // The nine core agents are the island as sold; specialists are opt-in (§9).
    enabledByDefault: spec.core,
    webSearch: spec.webSearch ?? false,
    needsMarketData: spec.needsMarketData ?? false,
    systemPrompt: promptFor(spec.id),
    outputSchema: schemaFor(spec.id, spec.core),
    map: { x: spec.x, y: spec.y },
    summary: spec.summary,
  };
}

/** Ordered by stage, and within a stage from west to east along the trail. */
export const AGENTS: AgentDefinition[] = [
  define({
    id: 'task_manager',
    name: 'Task Manager',
    emoji: '🧭',
    role: 'Mission planning',
    summary: 'Turns the request into an executable mission plan and picks the agents.',
    stage: 'plan',
    dependsOn: [],
    core: true,
    x: 4,
    y: 34,
  }),
  define({
    id: 'research',
    name: 'Research Agent',
    emoji: '🔍',
    role: 'Primary research',
    summary: 'Finds sourced facts on the live web and records every source it used.',
    stage: 'gather',
    dependsOn: ['task_manager'],
    core: true,
    webSearch: true,
    x: 22,
    y: 9,
  }),
  define({
    id: 'competitor',
    name: 'Competitor Agent',
    emoji: '🕵️',
    role: 'Competitive landscape',
    summary: 'Names real competitors, what they charge, and the gaps they leave.',
    stage: 'gather',
    dependsOn: ['research'],
    core: true,
    webSearch: true,
    x: 40,
    y: 9,
  }),
  define({
    id: 'customer_research',
    name: 'Customer Research Agent',
    emoji: '🗣️',
    role: 'Customer voice',
    summary: 'Gathers what real customers say, pay for and complain about today.',
    stage: 'gather',
    dependsOn: ['task_manager'],
    core: false,
    webSearch: true,
    x: 22,
    y: 59,
  }),
  define({
    id: 'technology',
    name: 'Technology Agent',
    emoji: '🛠️',
    role: 'Technical feasibility',
    summary: 'Judges what must be built or bought, and where the technical risk sits.',
    stage: 'gather',
    dependsOn: ['task_manager'],
    core: false,
    x: 77,
    y: 9,
  }),
  define({
    id: 'legal',
    name: 'Legal & Compliance Agent',
    emoji: '⚖️',
    role: 'Regulation and compliance',
    summary: 'Maps licences, regulation and compliance duties in the mission geography.',
    stage: 'gather',
    dependsOn: ['task_manager'],
    core: false,
    webSearch: true,
    x: 40,
    y: 59,
  }),
  define({
    id: 'market_analysis',
    name: 'Market Analysis Agent',
    emoji: '📊',
    role: 'Market assessment',
    summary: 'Judges demand, size, growth and how crowded the market already is.',
    stage: 'analyse',
    dependsOn: ['research', 'competitor'],
    core: true,
    x: 40,
    y: 34,
  }),
  define({
    id: 'analysis',
    name: 'Analysis Agent',
    emoji: '🧩',
    role: 'Cross-cutting analysis',
    summary: 'Finds the patterns, the weak spots and the unsupported assumptions.',
    stage: 'analyse',
    dependsOn: ['research'],
    core: true,
    x: 22,
    y: 34,
  }),
  define({
    id: 'marketing',
    name: 'Marketing Agent',
    emoji: '📣',
    role: 'Positioning and channels',
    summary: 'Works out positioning, message and the channels worth testing first.',
    stage: 'analyse',
    dependsOn: ['market_analysis'],
    core: false,
    x: 58,
    y: 9,
  }),
  define({
    id: 'risk_verification',
    name: 'Risk & Verification Agent',
    emoji: '🛡️',
    role: 'Verification gate',
    summary: 'Audits every claim and holds the gate until the work stands up.',
    stage: 'verify',
    dependsOn: ['research', 'analysis'],
    core: true,
    x: 58,
    y: 34,
  }),
  define({
    id: 'financial',
    name: 'Financial Agent',
    emoji: '💰',
    role: 'Costs and revenue',
    summary: 'Builds costs, three revenue scenarios and break-even, every line labelled.',
    stage: 'quantify',
    dependsOn: ['risk_verification'],
    core: true,
    x: 58,
    y: 59,
  }),
  define({
    id: 'operations',
    name: 'Operations Agent',
    emoji: '⚙️',
    role: 'Day-to-day delivery',
    summary: 'Checks whether the thing can actually be run day to day, and at what capacity.',
    stage: 'quantify',
    dependsOn: ['risk_verification'],
    core: false,
    x: 77,
    y: 59,
  }),
  define({
    id: 'strategy',
    name: 'Strategy Agent',
    emoji: '♟️',
    role: 'Decision and plan',
    summary: 'Turns verified evidence into a decision, a phased plan and stop conditions.',
    stage: 'strategise',
    dependsOn: ['financial', 'risk_verification'],
    core: true,
    x: 77,
    y: 34,
  }),
  // --- Forex desk. Off by default: most missions are not about a currency, and
  // a desk that runs when nobody asked for it is just cost. ------------------
  define({
    id: 'market_context',
    name: 'Market Context Agent',
    emoji: '🌐',
    role: 'Currency drivers and calendar',
    summary: 'Establishes what is actually moving a pair: policy, rates, flows and the events ahead.',
    stage: 'gather',
    dependsOn: ['task_manager'],
    core: false,
    webSearch: true,
    x: 6,
    y: 18,
  }),
  define({
    id: 'technical_analysis',
    name: 'Technical Analysis Agent',
    emoji: '📉',
    role: 'Structure and levels',
    summary: 'Reads trend and structure, and refuses to invent a price it could not retrieve.',
    stage: 'analyse',
    dependsOn: ['market_context'],
    core: false,
    // The only agent that is handed prices. Its whole job is levels, and a
    // level it did not read off a candle is a number someone may risk money
    // against — so it gets the feed, and nobody else gets it by accident.
    needsMarketData: true,
    x: 91,
    y: 17,
  }),
  define({
    id: 'trade_thesis',
    name: 'Trade Thesis Agent',
    emoji: '🧭',
    role: 'Directional thesis',
    summary: 'Says what it thinks is happening and what would prove it wrong. Never a signal.',
    stage: 'strategise',
    dependsOn: ['technical_analysis', 'risk_verification'],
    core: false,
    x: 91,
    y: 50,
  }),
  define({
    id: 'chief_ai',
    name: 'Chief AI Agent',
    emoji: '👑',
    role: 'Independent final review',
    summary: 'Re-reviews the whole mission independently and issues the final call.',
    stage: 'review',
    // The gate as well as the strategy. The Chief writes the report's headline
    // decision, its labels and its confidence, and depending on strategy alone
    // meant it did all of that having never been shown what the verification
    // agent flagged, contradicted or refused to pass. risk_verification already
    // runs before strategy, so this adds a dependency without adding a wave.
    dependsOn: ['strategy', 'risk_verification'],
    core: true,
    x: 94,
    y: 34,
  }),
];

const BY_ID = new Map(AGENTS.map((agent) => [agent.id, agent]));

export const CORE_AGENT_IDS: string[] = AGENTS.filter((agent) => agent.core).map((agent) => agent.id);

export function getAgent(id: string): AgentDefinition | undefined {
  return BY_ID.get(id);
}

export function requireAgent(id: string): AgentDefinition {
  const agent = BY_ID.get(id);
  if (!agent) throw badRequest(`Unknown island agent "${id}".`);
  return agent;
}

/**
 * Writes the roster into island_agents.
 *
 * The table is platform-global and exists so the database can be read on its
 * own — for support, for a migration, for a report written straight from SQL.
 * Code always reads AGENTS, so this is a projection, not a source of truth, and
 * running it on every boot is how the two stay in step. An agent that has been
 * removed from the code is marked inactive rather than deleted: merchants may
 * still hold override rows pointing at it, and a foreign key would take those
 * with it.
 */
export function syncAgentRoster(db: Db): void {
  const upsert = db.prepare(`
    INSERT INTO island_agents (agent_id, name, emoji, role, summary, stage, depends_on, system_prompt,
                               is_core, web_search, enabled_by_default, active, map_x, map_y,
                               sort_order, updated_at)
    VALUES (@agent_id, @name, @emoji, @role, @summary, @stage, @depends_on, @system_prompt,
            @is_core, @web_search, @enabled_by_default, 1, @map_x, @map_y,
            @sort_order, @updated_at)
    ON CONFLICT(agent_id) DO UPDATE SET
      name = excluded.name,
      emoji = excluded.emoji,
      role = excluded.role,
      summary = excluded.summary,
      stage = excluded.stage,
      depends_on = excluded.depends_on,
      system_prompt = excluded.system_prompt,
      is_core = excluded.is_core,
      web_search = excluded.web_search,
      enabled_by_default = excluded.enabled_by_default,
      active = 1,
      map_x = excluded.map_x,
      map_y = excluded.map_y,
      sort_order = excluded.sort_order,
      updated_at = excluded.updated_at
  `);
  const placeholders = AGENTS.map(() => '?').join(', ');
  const retire = db.prepare(
    `UPDATE island_agents SET active = 0, updated_at = ? WHERE agent_id NOT IN (${placeholders})`,
  );

  const updatedAt = nowIso();
  db.transaction(() => {
    AGENTS.forEach((agent, index) => {
      upsert.run({
        agent_id: agent.id,
        name: agent.name,
        emoji: agent.emoji,
        role: agent.role,
        summary: agent.summary,
        stage: agent.stage,
        depends_on: JSON.stringify(agent.dependsOn),
        system_prompt: agent.systemPrompt,
        is_core: agent.core ? 1 : 0,
        web_search: agent.webSearch ? 1 : 0,
        enabled_by_default: agent.enabledByDefault ? 1 : 0,
        map_x: agent.map.x,
        map_y: agent.map.y,
        sort_order: index,
        updated_at: updatedAt,
      });
    });
    retire.run(updatedAt, ...AGENTS.map((agent) => agent.id));
  })();
}

/** The roster as this merchant sees it: product definitions plus their own switches. */
export function rosterForMerchant(store: TenantStore): { definition: AgentDefinition; enabled: boolean }[] {
  const overrides = new Map<string, boolean>(
    store
      .list<{ agent_id: string; enabled: number }>('island_agent_settings', {
        columns: 'agent_id, enabled',
      })
      .map((row) => [row.agent_id, row.enabled === 1]),
  );
  return AGENTS.map((definition) => ({
    definition,
    enabled: overrides.get(definition.id) ?? definition.enabledByDefault,
  }));
}

/** Only overrides are stored, so a merchant who never touches the roster keeps
 *  following the product defaults as those change. */
export function setAgentEnabled(store: TenantStore, agentId: string, enabled: boolean): void {
  requireAgent(agentId);
  const existing = store.findBy<{ id: string }>('island_agent_settings', 'agent_id = @agentId', { agentId });
  const updatedAt = nowIso();
  if (existing) {
    store.update('island_agent_settings', existing.id, { enabled: enabled ? 1 : 0, updated_at: updatedAt });
    return;
  }
  store.insert('island_agent_settings', {
    id: newId('ias'),
    agent_id: agentId,
    enabled: enabled ? 1 : 0,
    updated_at: updatedAt,
  });
}

/**
 * Groups the enabled agents into waves the orchestrator can run in parallel.
 *
 * A dependency that is not enabled is dropped from the constraint rather than
 * pulling the agent out with it: switching off an optional specialist must not
 * silently remove the agents downstream of it. Ordering inside a wave follows
 * the registry, so the same roster always plans the same way.
 */
export function planWaves(enabledIds: string[]): string[][] {
  const wanted = new Set<string>();
  for (const id of enabledIds) {
    requireAgent(id);
    wanted.add(id);
  }

  const deps = new Map<string, string[]>();
  let remaining = AGENTS.filter((agent) => wanted.has(agent.id)).map((agent) => {
    deps.set(agent.id, agent.dependsOn.filter((dependency) => wanted.has(dependency)));
    return agent.id;
  });

  const done = new Set<string>();
  const waves: string[][] = [];
  while (remaining.length > 0) {
    const wave = remaining.filter((id) => (deps.get(id) ?? []).every((dependency) => done.has(dependency)));
    if (wave.length === 0) {
      throw new Error(
        `Island agent dependency cycle: none of [${remaining.join(', ')}] can ever start because ` +
          'each is waiting on another. Fix dependsOn in the agent registry.',
      );
    }
    for (const id of wave) done.add(id);
    waves.push(wave);
    remaining = remaining.filter((id) => !done.has(id));
  }
  return waves;
}

/**
 * Configuration for the AI Agent Island.
 *
 * Read once at module load, the same way server/src/config.ts does it, so that
 * a mission cannot change engine, model or budget while it is halfway through
 * a run. Every limit here is a spending limit as much as a safety limit: each
 * agent is a separate model call, and a fourteen-agent mission with correction
 * rounds can make a lot of them.
 */

// Imported for its side effect: that module is what loads .env, and the values
// below are read at import time, which can happen before app.ts is evaluated.
import '../config';
import type { EngineKind } from './types';

function textFromEnv(name: string): string | null {
  const raw = process.env[name]?.trim();
  return raw ? raw : null;
}

/**
 * Reads a whole-number setting, refusing values that would break the engine
 * rather than quietly accepting them. A `maxAttempts` of 0 would skip every
 * agent and still report a completed mission, which is exactly the kind of
 * silent nonsense this system is built to avoid.
 */
function intFromEnv(name: string, fallback: number, minimum = 0): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, parsed);
}

export const islandConfig = {
  /** Either variable works; the SDK accepts the same credential under both names. */
  apiKey: textFromEnv('ANTHROPIC_API_KEY') ?? textFromEnv('ANTHROPIC_AUTH_TOKEN'),
  model: textFromEnv('ISLAND_MODEL') ?? 'claude-opus-5',
  maxWebSearches: intFromEnv('ISLAND_MAX_WEB_SEARCHES', 6, 1),
  /** Schema-repair round trips before an agent is declared failed (§21 rule 2). */
  maxRepairs: intFromEnv('ISLAND_MAX_REPAIRS', 2, 0),
  /** Attempts per agent before the backup agent, then failure (§16). */
  maxAttempts: intFromEnv('ISLAND_MAX_ATTEMPTS', 2, 1),
  /** Verification gate rounds before unresolved issues are carried into the report (§8). */
  maxCorrectionRounds: intFromEnv('ISLAND_MAX_CORRECTION_ROUNDS', 3, 0),
  maxConcurrentAgents: intFromEnv('ISLAND_MAX_CONCURRENCY', 3, 1),
  agentTimeoutMs: intFromEnv('ISLAND_AGENT_TIMEOUT_MS', 240_000, 1_000),
  missionsPerDay: intFromEnv('ISLAND_MISSIONS_PER_DAY', 25, 1),
  enabled: process.env.ISLAND_ENABLED !== 'false',
  /**
   * The price feed for the forex desk.
   *
   * No key is the normal state, not a misconfiguration: with none the island
   * runs exactly as it does without a feed at all, and the Technical Analysis
   * Agent reports having no prices rather than producing a level from memory.
   */
  research: {
    /** JSON array of ResearchConnector, overriding the shipped Maldives list.
     *  A deployment serving another market points this somewhere else rather
     *  than editing the source. */
    connectors: textFromEnv('RESEARCH_CONNECTORS'),
    /** A connector the orchestrator is waiting on must not hang a mission. */
    timeoutMs: intFromEnv('RESEARCH_TIMEOUT_MS', 9_000, 1_000),
    /** Characters of stripped text kept per page: enough for a statistics table
     *  to survive, few enough that four of them still fit in one envelope. */
    maxChars: intFromEnv('RESEARCH_MAX_CHARS', 18_000, 1_000),
  },
  marketData: {
    provider: textFromEnv('MARKET_DATA_PROVIDER') ?? 'twelvedata',
    apiKey: textFromEnv('MARKET_DATA_API_KEY'),
    interval: textFromEnv('MARKET_DATA_INTERVAL') ?? '1day',
    /** Candles per request: enough history to read structure, few enough that a
     *  free-tier response stays small. */
    candles: intFromEnv('MARKET_DATA_CANDLES', 120, 1),
  },
} as const;

/**
 * Which engine will actually answer.
 *
 * Recorded on every mission so a report produced without a live model can never
 * be mistaken for real research. With no credential there is nothing to call,
 * and the simulation provider takes over — structurally valid output that says
 * plainly it is a demonstration.
 */
export function engineKind(): EngineKind {
  return islandConfig.apiKey ? 'claude' : 'simulation';
}

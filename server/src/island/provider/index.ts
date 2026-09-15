/**
 * Which engine actually runs an agent.
 *
 * One instance per engine kind, kept for the life of the process: the Claude
 * provider holds an SDK client worth reusing across a mission, and the
 * simulation provider tracks which missions have already been through a
 * verification round. Both would be broken by handing out a fresh instance per
 * agent, which is why this is memoised rather than a plain factory.
 */
import { engineKind } from '../config';
import type { AgentProvider, EngineKind } from '../types';
import { ClaudeProvider } from './claude';
import { SimulationProvider } from './simulation';

const instances = new Map<EngineKind, AgentProvider>();

/** Set by tests; takes precedence over everything below while it is set. */
let override: AgentProvider | null = null;

export function getProvider(kind?: EngineKind): AgentProvider {
  if (override) return override;

  const resolved = kind ?? engineKind();
  const existing = instances.get(resolved);
  if (existing) return existing;

  const created: AgentProvider =
    resolved === 'claude' ? new ClaudeProvider() : new SimulationProvider();
  instances.set(resolved, created);
  return created;
}

/**
 * Test seam. Passing null both clears the override and drops the memoised
 * instances, so a test that changed the environment gets providers built
 * against the new configuration rather than the old one.
 */
export function setProvider(provider: AgentProvider | null): void {
  override = provider;
  if (!provider) instances.clear();
}

export { buildSystemPrompt, buildUserMessage } from './envelope';
export { ClaudeProvider } from './claude';
export { SimulationProvider } from './simulation';

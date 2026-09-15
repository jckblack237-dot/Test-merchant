import { createApp } from './app';
import { config } from './config';
import { getDb } from './db';
import { assertTenantTablesAreScoped } from './db/tenant';
import { syncAgentRoster } from './island/agents/registry';
import { engineKind, islandConfig } from './island/config';
import { reconcileInterruptedMissions } from './island/store';

/** What the island will actually do on this boot, in one line an operator can act on. */
function islandStatus(): string {
  if (!islandConfig.enabled) return 'disabled (ISLAND_ENABLED=false) — no mission can be started';
  if (engineKind() === 'claude') return `live on ${islandConfig.model}`;
  return 'simulation engine — no ANTHROPIC_API_KEY is set, so reports are demonstrations, not research';
}

function main(): void {
  const db = getDb();
  // Fail fast if a merchant-owned table was added without tenant scoping.
  assertTenantTablesAreScoped(db);

  // Opening the database already projected the roster into island_agents;
  // asserting it again costs fourteen upserts and means no boot can serve an
  // agent list that has drifted from the code.
  syncAgentRoster(db);
  // The orchestrator lives in this process, so nothing survived the last
  // shutdown. Close out anything still claiming to be running before the first
  // request can watch it forever.
  reconcileInterruptedMissions(db);

  const app = createApp();
  app.listen(config.port, () => {
    console.log(`LoyaltyLoop API listening on http://localhost:${config.port} (${config.nodeEnv})`);
    console.log(`Database: ${config.databasePath}`);
    console.log(`AI Agent Island: ${islandStatus()}`);
    if (!config.isProduction) {
      console.log(`Allowed origins: ${config.corsOrigins.join(', ')}`);
    }
  });
}

main();

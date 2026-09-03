import { createApp } from './app';
import { config } from './config';
import { getDb } from './db';
import { assertTenantTablesAreScoped } from './db/tenant';

function main(): void {
  const db = getDb();
  // Fail fast if a merchant-owned table was added without tenant scoping.
  assertTenantTablesAreScoped(db);

  const app = createApp();
  app.listen(config.port, () => {
    console.log(`LoyaltyLoop API listening on http://localhost:${config.port} (${config.nodeEnv})`);
    console.log(`Database: ${config.databasePath}`);
    if (!config.isProduction) {
      console.log(`Allowed origins: ${config.corsOrigins.join(', ')}`);
    }
  });
}

main();

import Database from 'better-sqlite3';
import { config } from '../config';
import { SCHEMA_SQL } from './schema';
import { seedPlans } from './plans';
import { syncAgentRoster } from '../island/agents/registry';

export type Db = Database.Database;

let instance: Db | null = null;

export function openDatabase(filePath = config.databasePath): Db {
  const db = new Database(filePath);
  // WAL keeps readers (dashboard queries) from blocking writers (point awards).
  if (filePath !== ':memory:') db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec(SCHEMA_SQL);
  seedPlans(db);
  // The island roster is product code, not merchant data: it is seeded here
  // alongside the plan catalogue so that every database — dev, test, a fresh
  // production boot — has the agents its island_agent_settings rows reference.
  syncAgentRoster(db);
  return db;
}

export function getDb(): Db {
  if (!instance) instance = openDatabase();
  return instance;
}

/** Test helper: swap in an isolated in-memory database. */
export function setDb(db: Db): void {
  instance = db;
}

export function closeDb(): void {
  instance?.close();
  instance = null;
}

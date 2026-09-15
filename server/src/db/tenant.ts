import type Database from 'better-sqlite3';
import { getDb } from './index';
import { notFound } from '../lib/errors';
import { nowIso } from '../lib/time';
import { newId } from '../lib/ids';

/**
 * Every table whose rows belong to exactly one merchant.
 *
 * Adding a merchant-owned table without listing it here is the one mistake that
 * could leak data between tenants, so `assertTenantTablesAreScoped()` runs at
 * boot and fails fast if the database contains a `merchant_id` column on a
 * table missing from this set.
 */
export const TENANT_TABLES = new Set([
  'merchant_users',
  'locations',
  'products',
  'tiers',
  'memberships',
  'rewards',
  'redemptions',
  'transactions',
  'campaigns',
  'api_keys',
  'audit_logs',
  // AI Agent Island. The agent roster itself is platform-global (product code,
  // no merchant_id); everything a mission produces is merchant-owned.
  'island_missions',
  'island_agent_runs',
  'island_sources',
  'island_verifications',
  'island_corrections',
  'island_events',
  'island_followups',
  'island_agent_settings',
]);

export type TenantTable =
  | 'merchant_users' | 'locations' | 'products' | 'tiers' | 'memberships'
  | 'rewards' | 'redemptions' | 'transactions' | 'campaigns' | 'api_keys' | 'audit_logs'
  | 'island_missions' | 'island_agent_runs' | 'island_sources' | 'island_verifications'
  | 'island_corrections' | 'island_events' | 'island_followups' | 'island_agent_settings';

type Row = Record<string, unknown>;
type Params = Record<string, unknown>;

export interface ListOptions {
  /** Extra SQL predicate, e.g. `is_active = @isActive`. Never interpolate user input here. */
  where?: string;
  params?: Params;
  orderBy?: string;
  limit?: number;
  offset?: number;
  columns?: string;
}

const IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function assertTenantTable(table: string): asserts table is TenantTable {
  if (!TENANT_TABLES.has(table)) {
    throw new Error(
      `TenantStore refused to touch "${table}": it is not a registered tenant table. ` +
        'Use the global db handle for platform tables, or register the table in TENANT_TABLES.',
    );
  }
}

/**
 * Defence in depth for the few places that need a hand-written query (joins,
 * aggregates). Scans the FROM/JOIN targets and insists that any tenant table
 * referenced is filtered by merchant_id somewhere in the statement.
 *
 * This is a guard rail, not a SQL parser — the primary protection is that all
 * ordinary access goes through TenantStore, which builds the predicate itself.
 */
export function assertTenantSafeSql(sql: string): void {
  const normalised = sql.replace(/\s+/g, ' ');
  const referenced = new Set<string>();
  const re = /\b(?:from|join)\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(normalised)) !== null) {
    const table = match[1]!.toLowerCase();
    if (TENANT_TABLES.has(table)) referenced.add(table);
  }
  if (referenced.size === 0) return;
  const filtersByMerchant = /merchant_id\s*(=|in)\s*[@:$?]/i.test(normalised);
  if (!filtersByMerchant) {
    throw new Error(
      `Unsafe query: touches tenant table(s) [${[...referenced].join(', ')}] without a bound merchant_id filter. ` +
        `Query: ${normalised.slice(0, 200)}`,
    );
  }
}

/** Boot-time check that the schema and TENANT_TABLES have not drifted apart. */
export function assertTenantTablesAreScoped(db: Database.Database = getDb()): void {
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
    .all() as { name: string }[];
  const allowedGlobals = new Set(['refresh_tokens', 'security_events', 'merchants']);
  for (const { name } of tables) {
    const columns = db.prepare(`PRAGMA table_info(${name})`).all() as { name: string }[];
    const hasMerchantId = columns.some((c) => c.name === 'merchant_id');
    if (hasMerchantId && !TENANT_TABLES.has(name) && !allowedGlobals.has(name)) {
      throw new Error(
        `Table "${name}" has a merchant_id column but is not registered in TENANT_TABLES. ` +
          'Register it so tenant scoping is enforced, or add it to the reviewed global allow-list.',
      );
    }
  }
}

/**
 * A merchant-locked view of the database.
 *
 * The merchant id is captured once, from the authenticated principal, and is
 * appended to the WHERE clause of every statement this class builds. Callers
 * cannot pass a merchant_id of their own — `insert()` overwrites it and the
 * update/delete/read paths always AND it in. That makes "forgot to filter by
 * tenant" structurally impossible for code that uses this store.
 */
export class TenantStore {
  constructor(
    readonly merchantId: string,
    private readonly db: Database.Database = getDb(),
  ) {
    if (!merchantId) throw new Error('TenantStore requires a merchant id.');
  }

  /** Escape hatch for platform-level tables. Tenant tables still go via this class. */
  get handle(): Database.Database {
    return this.db;
  }

  list<T extends Row = Row>(table: TenantTable, options: ListOptions = {}): T[] {
    assertTenantTable(table);
    const columns = options.columns ?? '*';
    const extra = options.where ? ` AND (${options.where})` : '';
    const order = options.orderBy ? ` ORDER BY ${options.orderBy}` : '';
    const limit = options.limit !== undefined ? ` LIMIT ${Number(options.limit)}` : '';
    const offset = options.offset !== undefined ? ` OFFSET ${Number(options.offset)}` : '';
    const sql = `SELECT ${columns} FROM ${table} WHERE merchant_id = @__merchantId${extra}${order}${limit}${offset}`;
    return this.db.prepare(sql).all({ ...(options.params ?? {}), __merchantId: this.merchantId }) as T[];
  }

  count(table: TenantTable, where?: string, params: Params = {}): number {
    assertTenantTable(table);
    const extra = where ? ` AND (${where})` : '';
    const sql = `SELECT COUNT(*) AS n FROM ${table} WHERE merchant_id = @__merchantId${extra}`;
    const row = this.db.prepare(sql).get({ ...params, __merchantId: this.merchantId }) as { n: number };
    return row.n;
  }

  find<T extends Row = Row>(table: TenantTable, id: string): T | undefined {
    assertTenantTable(table);
    const sql = `SELECT * FROM ${table} WHERE id = @__id AND merchant_id = @__merchantId`;
    return this.db.prepare(sql).get({ __id: id, __merchantId: this.merchantId }) as T | undefined;
  }

  /** Same as find() but raises the 404 that hides another tenant's id space. */
  findOrFail<T extends Row = Row>(table: TenantTable, id: string, label = 'Record'): T {
    const row = this.find<T>(table, id);
    if (!row) throw notFound(`${label} not found.`);
    return row;
  }

  findBy<T extends Row = Row>(table: TenantTable, where: string, params: Params = {}): T | undefined {
    assertTenantTable(table);
    const sql = `SELECT * FROM ${table} WHERE merchant_id = @__merchantId AND (${where}) LIMIT 1`;
    return this.db.prepare(sql).get({ ...params, __merchantId: this.merchantId }) as T | undefined;
  }

  insert<T extends Row = Row>(table: TenantTable, values: Row): T {
    assertTenantTable(table);
    // merchant_id is set from the authenticated session, never from the payload.
    const record: Row = { ...values, merchant_id: this.merchantId };
    const keys = Object.keys(record);
    for (const key of keys) {
      if (!IDENTIFIER.test(key)) throw new Error(`Illegal column name: ${key}`);
    }
    const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map((k) => `@${k}`).join(', ')})`;
    this.db.prepare(sql).run(record);
    return this.findOrFail<T>(table, String(record.id));
  }

  update<T extends Row = Row>(table: TenantTable, id: string, values: Row, label = 'Record'): T {
    assertTenantTable(table);
    const record: Row = { ...values };
    delete record.merchant_id; // callers may never move a row between tenants
    delete record.id;
    const keys = Object.keys(record);
    if (keys.length === 0) return this.findOrFail<T>(table, id, label);
    for (const key of keys) {
      if (!IDENTIFIER.test(key)) throw new Error(`Illegal column name: ${key}`);
    }
    const assignments = keys.map((k) => `${k} = @${k}`).join(', ');
    const sql = `UPDATE ${table} SET ${assignments} WHERE id = @__id AND merchant_id = @__merchantId`;
    const result = this.db.prepare(sql).run({ ...record, __id: id, __merchantId: this.merchantId });
    if (result.changes === 0) throw notFound(`${label} not found.`);
    return this.findOrFail<T>(table, id, label);
  }

  delete(table: TenantTable, id: string, label = 'Record'): void {
    assertTenantTable(table);
    const sql = `DELETE FROM ${table} WHERE id = @__id AND merchant_id = @__merchantId`;
    const result = this.db.prepare(sql).run({ __id: id, __merchantId: this.merchantId });
    if (result.changes === 0) throw notFound(`${label} not found.`);
  }

  /**
   * Hand-written read for joins and aggregates. `@merchantId` is bound for you
   * and the statement is checked by assertTenantSafeSql before it runs.
   */
  query<T extends Row = Row>(sql: string, params: Params = {}): T[] {
    assertTenantSafeSql(sql);
    return this.db.prepare(sql).all({ ...params, merchantId: this.merchantId }) as T[];
  }

  queryOne<T extends Row = Row>(sql: string, params: Params = {}): T | undefined {
    assertTenantSafeSql(sql);
    return this.db.prepare(sql).get({ ...params, merchantId: this.merchantId }) as T | undefined;
  }

  /** Runs `fn` inside a SQLite transaction; any throw rolls the whole thing back. */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  writeAudit(entry: {
    actorType: string;
    actorId?: string | null;
    actorLabel?: string;
    action: string;
    entityType?: string;
    entityId?: string | null;
    ip?: string | null;
    userAgent?: string | null;
    meta?: unknown;
  }): void {
    this.db
      .prepare(
        `INSERT INTO audit_logs (id, merchant_id, actor_type, actor_id, actor_label, action,
                                 entity_type, entity_id, ip, user_agent, meta, created_at)
         VALUES (@id, @merchant_id, @actor_type, @actor_id, @actor_label, @action,
                 @entity_type, @entity_id, @ip, @user_agent, @meta, @created_at)`,
      )
      .run({
        id: newId('aud'),
        merchant_id: this.merchantId,
        actor_type: entry.actorType,
        actor_id: entry.actorId ?? null,
        actor_label: entry.actorLabel ?? '',
        action: entry.action,
        entity_type: entry.entityType ?? '',
        entity_id: entry.entityId ?? null,
        ip: entry.ip ?? null,
        user_agent: entry.userAgent ?? null,
        meta: JSON.stringify(entry.meta ?? {}),
        created_at: nowIso(),
      });
  }
}

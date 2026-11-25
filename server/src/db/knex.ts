import knexFactory, { type Knex } from 'knex';
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { config } from '../config.js';

// Return DATE columns as plain 'YYYY-MM-DD' strings (never shifted by timezone),
// and BIGINT (amounts, ids) as JS numbers - all values are far below 2^53.
pg.types.setTypeParser(1082, (v: string) => v);
pg.types.setTypeParser(20, (v: string) => Number(v));

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, 'migrations');

/**
 * Migrations are recorded without their extension so the same history works for
 * `tsx` in development (.ts) and the compiled build in production (.js).
 */
const migrationSource: Knex.MigrationSource<string> = {
  async getMigrations() {
    return fs
      .readdirSync(migrationsDir)
      .filter((f) => /\.(ts|js)$/.test(f) && !f.endsWith('.d.ts'))
      .sort();
  },
  getMigrationName(file) {
    return file.replace(/\.(ts|js)$/, '');
  },
  async getMigration(file) {
    return import(pathToFileURL(path.join(migrationsDir, file)).href);
  },
};

export function knexConfig(connection = config.DATABASE_URL): Knex.Config {
  const schema = config.DATABASE_SCHEMA;
  return {
    client: 'pg',
    connection: config.DATABASE_SSL
      ? { connectionString: connection, ssl: { rejectUnauthorized: false } }
      : connection,
    // UOS tenant databases hold one schema per module; this app's tables (and its
    // knex_migrations) live in DATABASE_SCHEMA when it is set.
    ...(schema ? { searchPath: [schema] } : {}),
    pool: { min: 0, max: 10 },
    migrations: { migrationSource, tableName: 'knex_migrations', ...(schema ? { schemaName: schema } : {}) },
  };
}

export const db: Knex = knexFactory(knexConfig());

/**
 * Applies pending migrations, as MIGRATION_DATABASE_URL when set (UOS: the module's
 * <prefix>_admin role), then grants the request role (DB_APP_ROLE, UOS: <prefix>_app)
 * rights on every table and sequence in the schema. Returns the migrations that ran.
 */
export async function migrateLatest(): Promise<string[]> {
  const separate = Boolean(config.MIGRATION_DATABASE_URL && config.MIGRATION_DATABASE_URL !== config.DATABASE_URL);
  const k = separate ? knexFactory({ ...knexConfig(config.MIGRATION_DATABASE_URL), pool: { min: 0, max: 1 } }) : db;
  try {
    const schema = config.DATABASE_SCHEMA;
    if (schema) {
      const exists = await k('information_schema.schemata').where({ schema_name: schema }).first();
      // The UOS provisioning script creates module schemas; create it only for local/standalone setups.
      if (!exists) await k.raw('CREATE SCHEMA ??', [schema]);
    }
    const [, ran] = (await k.migrate.latest()) as [number, string[]];
    if (config.DB_APP_ROLE) {
      const s = schema || 'public';
      await k.raw('GRANT USAGE ON SCHEMA ?? TO ??', [s, config.DB_APP_ROLE]);
      await k.raw('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ?? TO ??', [s, config.DB_APP_ROLE]);
      await k.raw('GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA ?? TO ??', [s, config.DB_APP_ROLE]);
    }
    return ran;
  } finally {
    if (separate) await k.destroy();
  }
}

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
  return {
    client: 'pg',
    connection: config.DATABASE_SSL
      ? { connectionString: connection, ssl: { rejectUnauthorized: false } }
      : connection,
    pool: { min: 0, max: 10 },
    migrations: { migrationSource, tableName: 'knex_migrations' },
  };
}

export const db: Knex = knexFactory(knexConfig());

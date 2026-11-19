/**
 * LOCAL DEVELOPMENT ONLY: sets a user's password in a dev/test database so imported
 * production data can be explored. Refuses to run against any other database.
 *
 *   DEV_SEED_PASSWORD=... npm run dev:password -w server -- admin baji 5812
 */
import { config } from '../src/config.js';
import { db } from '../src/db/knex.js';
import { hashPassword } from '../src/lib/passwords.js';
import { redis } from '../src/lib/redis.js';

async function main() {
  const dbName = new URL(config.DATABASE_URL).pathname.slice(1);
  if (config.NODE_ENV === 'production' || !/_(dev|test)$/.test(dbName)) {
    throw new Error(`Refusing: only allowed on *_dev / *_test databases (got "${dbName}")`);
  }
  const password = process.env.DEV_SEED_PASSWORD;
  if (!password || password.length < 8) throw new Error('Set DEV_SEED_PASSWORD (8+ chars) in server/.env');
  const users = process.argv.slice(2);
  if (!users.length) throw new Error('Usage: dev-set-password.ts <username> [...]');
  const hp = await hashPassword(password);
  for (const username of users) {
    const n = await db('users')
      .where({ username })
      .update({ ...hp, must_change_password: false, token_version: db.raw('token_version + 1') });
    console.log(n ? `updated ${username}` : `no such user: ${username}`);
  }
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => Promise.allSettled([db.destroy(), redis.quit()]));

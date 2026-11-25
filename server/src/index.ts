import { createApp } from './app.js';
import { config } from './config.js';
import { db, migrateLatest } from './db/knex.js';
import { redis } from './lib/redis.js';
import { createMainAdmins } from './routes/auth.js';
import { applyLinkEmails } from './uos/linkEmails.js';
import { closeUosRedis } from './uos/revocation.js';

async function main() {
  // Apply pending migrations on boot so a fresh deploy is always in sync.
  const ran = await migrateLatest();
  if (ran.length) console.log('Applied migrations:', ran.join(', '));

  if (config.ADMIN_BOOTSTRAP_PASSWORD) {
    const row = await db('users').count<{ c: string }[]>({ c: '*' }).first();
    if (Number(row?.c ?? 0) === 0) {
      await createMainAdmins(config.ADMIN_BOOTSTRAP_PASSWORD, 'env-bootstrap', '');
      console.log('Created main administrator accounts from ADMIN_BOOTSTRAP_PASSWORD');
    }
  }

  if (config.uos.enabled) {
    const linked = await applyLinkEmails();
    if (linked.length) console.log('UOS: set emails for', linked.join(', '));
    console.log(`UOS sign-in on: module ${config.uos.moduleId}, shell ${config.uos.shellUrl}, ${config.uos.campuses.length} campus(es)`);
  }

  const server = createApp().listen(config.PORT, () => {
    console.log(`St. Mary's voucher API listening on :${config.PORT} (${config.NODE_ENV})`);
  });

  const shutdown = (signal: string) => {
    console.log(`${signal} received, shutting down`);
    server.close(async () => {
      await Promise.allSettled([db.destroy(), redis.quit(), closeUosRedis()]);
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('Fatal startup error', err);
  process.exit(1);
});

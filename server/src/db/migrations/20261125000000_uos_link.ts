import type { Knex } from 'knex';

/**
 * Links Accounts users to UOS people.
 *
 * uos_user_id is the person's id on the UOS auth server (the module pass `sub`).
 * It is filled the first time the person opens Accounts from UOS, either by
 * matching their email to an existing user or by creating a new user.
 * New users created that way start as 'pending' until an Accounts admin approves them.
 */
async function statusCheckNames(knex: Knex): Promise<string[]> {
  const r = await knex.raw(
    `SELECT conname FROM pg_constraint
      WHERE conrelid = 'users'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%status%'`,
  );
  return (r.rows as { conname: string }[]).map((row) => row.conname);
}

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (t) => {
    t.text('uos_user_id');
    t.text('uos_org_id');
    t.timestamp('uos_linked_at', { useTz: true });
  });
  await knex.raw('CREATE UNIQUE INDEX users_uos_user_unique ON users (uos_user_id) WHERE uos_user_id IS NOT NULL');
  for (const name of await statusCheckNames(knex)) await knex.raw('ALTER TABLE users DROP CONSTRAINT ??', [name]);
  await knex.raw("ALTER TABLE users ADD CONSTRAINT users_status_check CHECK (status IN ('active','blocked','pending'))");
}

export async function down(knex: Knex): Promise<void> {
  await knex('users').where({ status: 'pending' }).update({ status: 'blocked' });
  for (const name of await statusCheckNames(knex)) await knex.raw('ALTER TABLE users DROP CONSTRAINT ??', [name]);
  await knex.raw("ALTER TABLE users ADD CONSTRAINT users_status_check CHECK (status IN ('active','blocked'))");
  await knex.raw('DROP INDEX IF EXISTS users_uos_user_unique');
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('uos_linked_at');
    t.dropColumn('uos_org_id');
    t.dropColumn('uos_user_id');
  });
}

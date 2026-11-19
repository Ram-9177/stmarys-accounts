import type { Knex } from 'knex';

/**
 * Initial PostgreSQL schema. Mirrors the Cloudflare D1 schema with proper types:
 * DATE for voucher dates, TIMESTAMPTZ for audit timestamps, BIGINT amounts,
 * TEXT[] for permission / college-access lists, BYTEA for vendor attachments.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('colleges', (t) => {
    t.text('code').primary();
    t.text('name').notNullable();
    t.text('location').notNullable().defaultTo('');
    t.text('logo_url').notNullable().defaultTo('');
    t.text('status').notNullable().defaultTo('active');
    t.text('created_by').notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.check("status in ('active','inactive')");
  });

  await knex.schema.createTable('users', (t) => {
    t.text('username').primary();
    t.text('email');
    t.text('password_hash').notNullable();
    // bcrypt for every new/changed password; pbkdf2/sha256 are legacy D1 hashes,
    // verified once and re-hashed with bcrypt on the next successful login.
    t.text('password_algo').notNullable().defaultTo('bcrypt');
    t.text('password_salt');
    t.text('role').notNullable();
    t.text('custom_role');
    t.text('status').notNullable().defaultTo('active');
    t.text('college').notNullable().defaultTo('smgg');
    t.specificType('college_access', 'text[]').notNullable().defaultTo('{}');
    t.specificType('permissions', 'text[]');
    t.text('full_name').notNullable().defaultTo('');
    t.boolean('must_change_password').notNullable().defaultTo(false);
    t.integer('token_version').notNullable().defaultTo(0);
    t.timestamp('last_login', { useTz: true });
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.check("role in ('admin','user')");
    t.check("status in ('active','blocked')");
    t.check("password_algo in ('bcrypt','pbkdf2','sha256')");
  });
  await knex.raw('CREATE UNIQUE INDEX users_email_unique ON users (lower(email)) WHERE email IS NOT NULL');

  await knex.schema.createTable('vouchers', (t) => {
    t.bigIncrements('id').primary();
    t.text('voucher_no');
    t.text('college').notNullable();
    t.text('type').notNullable();
    t.date('date').notNullable();
    t.text('head').notNullable();
    t.text('ac_name').notNullable().defaultTo('');
    t.text('received_from').notNullable().defaultTo('');
    t.text('paid_to').notNullable().defaultTo('');
    t.text('vendor_id').notNullable().defaultTo('');
    t.text('recipient_phone').notNullable().defaultTo('');
    t.date('reversal_date');
    t.text('towards').notNullable();
    t.text('block').notNullable().defaultTo('');
    t.bigInteger('amount').notNullable();
    t.text('amt_words').notNullable().defaultTo('');
    t.text('mode').notNullable().defaultTo('Cash');
    t.text('cheque').notNullable().defaultTo('');
    t.text('prep_by').notNullable().defaultTo('');
    t.text('checked_by').notNullable().defaultTo('');
    t.text('remarks').notNullable().defaultTo('');
    t.text('created_by').notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.text('updated_by');
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true });
    t.text('deleted_by');
    t.check("type in ('debit','onaccount','credit')");
    t.check('amount > 0');
  });
  await knex.raw('CREATE INDEX idx_vouchers_college_date ON vouchers (college, date) WHERE deleted_at IS NULL');
  await knex.raw('CREATE INDEX idx_vouchers_college_updated ON vouchers (college, updated_at)');
  await knex.raw('CREATE INDEX idx_vouchers_created_by ON vouchers (created_by)');

  await knex.schema.createTable('account_heads', (t) => {
    t.increments('id').primary();
    t.text('name').notNullable();
    t.text('name_norm').notNullable();
    t.text('type').notNullable().defaultTo('common');
    t.text('college').notNullable().defaultTo('smgg');
    t.text('created_by').notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.boolean('active').notNullable().defaultTo(true);
    t.unique(['name_norm', 'college']);
  });

  await knex.schema.createTable('blocks', (t) => {
    t.increments('id').primary();
    t.text('name').notNullable();
    t.text('name_norm').notNullable();
    t.text('college').notNullable().defaultTo('smgg');
    t.text('created_by').notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.boolean('active').notNullable().defaultTo(true);
    t.unique(['name_norm', 'college']);
  });

  await knex.schema.createTable('vendors', (t) => {
    t.bigIncrements('pk').primary();
    t.text('vendor_id').notNullable();
    t.text('college').notNullable().defaultTo('smgg');
    t.text('company_name').notNullable().defaultTo('');
    t.text('vendor_name').notNullable().defaultTo('');
    t.text('phone').notNullable().defaultTo('');
    t.text('pan').notNullable().defaultTo('');
    t.text('aadhaar').notNullable().defaultTo('');
    t.text('email').notNullable().defaultTo('');
    t.text('gst_number').notNullable().defaultTo('');
    t.text('bank_account_details').notNullable().defaultTo('');
    t.text('work_description').notNullable().defaultTo('');
    t.decimal('agreed_amount', 14, 2).notNullable().defaultTo(0);
    t.text('amount_in_words').notNullable().defaultTo('');
    t.text('period_start').notNullable().defaultTo('');
    t.text('period_end').notNullable().defaultTo('');
    t.text('auth_by').notNullable().defaultTo('');
    t.text('auth_role').notNullable().defaultTo('');
    t.text('auth_place').notNullable().defaultTo('');
    t.text('remarks').notNullable().defaultTo('');
    /** Any additional form fields the UI stores (agreement number, clauses...). Never contains file data. */
    t.jsonb('extra').notNullable().defaultTo('{}');
    t.text('created_by').notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.text('updated_by');
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true });
    t.text('deleted_by');
  });
  await knex.raw('CREATE UNIQUE INDEX vendors_college_vendor_id ON vendors (college, vendor_id) WHERE deleted_at IS NULL');

  await knex.schema.createTable('vendor_files', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.bigInteger('vendor_pk').notNullable().references('pk').inTable('vendors').onDelete('CASCADE');
    t.text('name').notNullable();
    t.text('mime').notNullable();
    t.integer('size').notNullable();
    t.binary('data').notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['vendor_pk']);
  });

  await knex.schema.createTable('audit_logs', (t) => {
    t.bigIncrements('id').primary();
    t.text('actor').notNullable();
    t.text('action').notNullable();
    t.text('entity_type').notNullable();
    t.text('entity_id').notNullable().defaultTo('');
    t.text('details').notNullable().defaultTo('');
    t.text('ip').notNullable().defaultTo('');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['created_at']);
  });

  await knex('colleges').insert([
    { code: 'smgg', name: "St. Mary's Group Of Institutions Guntur For Women", location: 'Guntur', created_by: 'system' },
    { code: 'smwec', name: "St. Mary's Women's Engineering College", location: 'Budampadu', created_by: 'system' },
    { code: 'smhyd', name: "St. Mary's Engineering College, Hyderabad", location: 'Hyderabad', created_by: 'system' },
  ]);
}

export async function down(knex: Knex): Promise<void> {
  for (const t of ['vendor_files', 'vendors', 'audit_logs', 'blocks', 'account_heads', 'vouchers', 'users', 'colleges']) {
    await knex.schema.dropTableIfExists(t);
  }
}

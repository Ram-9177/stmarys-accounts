/**
 * Imports a Cloudflare D1 backup into PostgreSQL.
 *
 *   npm run import:d1 -w server -- <backup.sql | backup.sqlite> [--wipe] [--dry-run]
 *
 * - Accepts the output of `wrangler d1 export --remote` (.sql) or a SQLite file.
 * - Runs in one transaction: either everything is imported or nothing is.
 * - Refuses to run against a database that already has vouchers unless --wipe is given.
 * - Keeps voucher and audit-log ids, so voucher numbers and references stay identical.
 * - Passwords are migrated as-is (PBKDF2 / SHA-256) and upgraded to bcrypt on each user's next login.
 * - Vendor attachments are moved out of the JSON blob into the vendor_files table.
 * - Sessions and rate-limit rows are not imported: everyone signs in again once.
 */
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { db } from '../src/db/knex.js';
import { redis } from '../src/lib/redis.js';
import { extraFields } from '../src/routes/vendors.js';
import { voucherNumber } from '../src/routes/vouchers.js';
import { clean, csvList, isoFromAny, isValidIsoDate, norm, normalizeCollegeCode } from '../src/lib/text.js';

type Row = Record<string, unknown>;

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const WIPE = args.includes('--wipe');
const DRY = args.includes('--dry-run');

function openSource(path: string): DatabaseSync {
  if (/\.sql$/i.test(path)) {
    const mem = new DatabaseSync(':memory:');
    mem.exec(fs.readFileSync(path, 'utf8'));
    return mem;
  }
  return new DatabaseSync(path, { readOnly: true });
}

const ts = (v: unknown): Date => {
  const d = v ? new Date(String(v)) : new Date();
  return Number.isNaN(d.getTime()) ? new Date() : d;
};
const tsOrNull = (v: unknown): Date | null => (v ? ts(v) : null);
const s = (v: unknown, max = 2000) => clean(v, max);

function tableExists(src: DatabaseSync, name: string): boolean {
  return !!src.prepare("select 1 from sqlite_master where type='table' and name=?").get(name);
}
function all(src: DatabaseSync, table: string): Row[] {
  return tableExists(src, table) ? (src.prepare(`select * from "${table}"`).all() as Row[]) : [];
}

async function chunkInsert(trx: typeof db, table: string, rows: Row[], size = 500) {
  for (let i = 0; i < rows.length; i += size) await trx(table).insert(rows.slice(i, i + size));
}

function decodeDataUrl(dataUrl: string): { mime: string; data: Buffer } | null {
  const m = /^data:([a-z0-9.+/-]*);base64,([A-Za-z0-9+/=]*)$/i.exec(dataUrl);
  return m ? { mime: m[1], data: Buffer.from(m[2], 'base64') } : null;
}
const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

async function main() {
  if (!file || !fs.existsSync(file)) {
    console.error('Usage: import-d1.ts <backup.sql|backup.sqlite> [--wipe] [--dry-run]');
    process.exitCode = 2;
    return;
  }
  await db.migrate.latest();
  const src = openSource(file);
  const report: Record<string, number> = {};
  const warnings: string[] = [];

  await db.transaction(async (trx) => {
    const existing = await trx('vouchers').count<{ c: string }[]>({ c: '*' }).first();
    if (Number(existing?.c ?? 0) > 0 && !WIPE) {
      throw new Error('Target database already has vouchers. Re-run with --wipe to replace ALL data.');
    }
    if (WIPE) {
      await trx.raw('TRUNCATE vendor_files, vendors, audit_logs, blocks, account_heads, vouchers, users RESTART IDENTITY CASCADE');
    }

    // Colleges
    for (const c of all(src, 'colleges')) {
      const code = normalizeCollegeCode(c.code);
      if (!code) continue;
      await trx('colleges')
        .insert({
          code,
          name: s(c.name, 160),
          location: s(c.location, 160),
          logo_url: s(c.logo_url, 500),
          status: c.status === 'inactive' ? 'inactive' : 'active',
          created_by: s(c.created_by) || 'system',
          created_at: ts(c.created_at),
          updated_at: ts(c.updated_at),
        })
        .onConflict('code')
        .merge(['name', 'location', 'logo_url', 'status', 'updated_at']);
      report.colleges = (report.colleges ?? 0) + 1;
    }

    // Users (legacy hashes preserved; upgraded to bcrypt at next login)
    const users = all(src, 'users').map((u) => {
      const legacySha = u.password_salt === 'legacy-sha256';
      const perms = csvList(u.permissions);
      return {
        username: s(u.username, 64).toLowerCase(),
        email: null,
        password_hash: s(u.password_hash, 500),
        password_algo: legacySha ? 'sha256' : 'pbkdf2',
        password_salt: legacySha ? null : s(u.password_salt, 200),
        role: u.role === 'admin' ? 'admin' : 'user',
        custom_role: s(u.custom_role, 40) || null,
        status: u.status === 'blocked' ? 'blocked' : 'active',
        college: normalizeCollegeCode(u.college) || 'smgg',
        college_access: csvList(u.college_access).map(normalizeCollegeCode),
        permissions: perms.length ? perms : null,
        full_name: s(u.full_name, 200),
        must_change_password: Number(u.must_change_password ?? 0) === 1,
        last_login: tsOrNull(u.last_login),
        created_at: ts(u.created_at),
        updated_at: ts(u.updated_at),
      };
    });
    await chunkInsert(trx, 'users', users);
    report.users = users.length;

    // Vouchers (ids preserved)
    const vouchers = all(src, 'vouchers').flatMap((v) => {
      const date = isoFromAny(v.date);
      const amount = Math.round(Number(v.amount ?? 0));
      const type = String(v.type);
      if (!isValidIsoDate(date) || !(amount > 0) || !['debit', 'onaccount', 'credit'].includes(type)) {
        warnings.push(`Skipped voucher id=${v.id}: invalid date/amount/type (${v.date}, ${v.amount}, ${v.type})`);
        return [];
      }
      const reversal = isoFromAny(v.reversal_date);
      const college = normalizeCollegeCode(v.college) || 'smgg';
      const createdAt = ts(v.created_at);
      return [
        {
          id: Number(v.id),
          voucher_no: s(v.voucher_no, 60) || voucherNumber(college, type, Number(v.id), createdAt.getFullYear()),
          college,
          type,
          date,
          head: s(v.head, 250) || '(none)',
          ac_name: s(v.ac_name, 250),
          received_from: s(v.received_from, 250),
          paid_to: s(v.paid_to, 250),
          vendor_id: s(v.vendor_id, 50),
          recipient_phone: s(v.recipient_phone, 30),
          reversal_date: isValidIsoDate(reversal) ? reversal : null,
          towards: s(v.towards, 500) || '-',
          block: s(v.block, 250),
          amount,
          amt_words: s(v.amt_words, 500),
          mode: s(v.mode, 50) || 'Cash',
          cheque: s(v.cheque, 120),
          prep_by: s(v.prep_by, 120),
          checked_by: s(v.checked_by, 120),
          remarks: s(v.remarks, 500),
          created_by: s(v.created_by, 64) || 'unknown',
          created_at: createdAt,
          updated_by: s(v.updated_by, 64) || null,
          updated_at: ts(v.updated_at || v.created_at),
          deleted_at: tsOrNull(v.deleted_at),
          deleted_by: s(v.deleted_by, 64) || null,
        },
      ];
    });
    await chunkInsert(trx, 'vouchers', vouchers);
    await trx.raw("select setval(pg_get_serial_sequence('vouchers','id'), greatest((select coalesce(max(id),0) from vouchers),1))");
    report.vouchers = vouchers.length;

    // Account heads & blocks
    for (const [table, hasType] of [['account_heads', true], ['blocks', false]] as const) {
      const rows = all(src, table).map((h) => ({
        name: s(h.name, 250),
        name_norm: norm(h.name),
        ...(hasType ? { type: ['debit', 'onaccount', 'credit', 'common'].includes(String(h.type)) ? String(h.type) : 'common' } : {}),
        college: normalizeCollegeCode(h.college) || 'smgg',
        created_by: s(h.created_by, 64) || 'system',
        created_at: ts(h.created_at),
        active: Number(h.active ?? 1) === 1,
      }));
      for (const r of rows) await trx(table).insert(r).onConflict(['name_norm', 'college']).ignore();
      report[table] = rows.length;
    }

    // Vendors + attachments
    let files = 0;
    for (const v of all(src, 'vendors')) {
      let data: Row = {};
      try {
        data = v.data_json ? (JSON.parse(String(v.data_json)) as Row) : {};
      } catch {
        warnings.push(`Vendor ${v.vendor_id}: data_json was not valid JSON, extra fields dropped`);
      }
      const agreement = (data.agreement ?? {}) as Row;
      const rawFiles = (Array.isArray(agreement.files) ? agreement.files : Array.isArray(data.files) ? data.files : []) as Row[];
      const [row] = await trx('vendors')
        .insert({
          vendor_id: s(v.vendor_id || v.id, 50),
          college: normalizeCollegeCode(v.college) || 'smgg',
          company_name: s(v.company_name, 250),
          vendor_name: s(v.vendor_name, 250),
          phone: s(v.phone, 50),
          pan: s(v.pan, 50),
          aadhaar: s(v.aadhaar, 50),
          email: s(v.email, 120),
          gst_number: s(v.gst_number, 50),
          bank_account_details: s(v.bank_account_details, 500),
          work_description: s(v.work_description, 1000),
          agreed_amount: Number(v.agreed_amount ?? 0) || 0,
          amount_in_words: s(v.amount_in_words, 500),
          period_start: s(v.period_start, 30),
          period_end: s(v.period_end, 30),
          auth_by: s(v.auth_by, 120),
          auth_role: s(v.auth_role, 120),
          auth_place: s(v.auth_place, 120),
          remarks: s(v.remarks, 1000),
          extra: JSON.stringify(extraFields(data)),
          created_by: s(v.created_by, 64) || 'unknown',
          created_at: ts(v.created_at),
          updated_by: s(v.updated_by, 64) || null,
          updated_at: ts(v.updated_at),
          deleted_at: tsOrNull(v.deleted_at),
          deleted_by: s(v.deleted_by, 64) || null,
        })
        .returning<{ pk: number }[]>('pk');
      for (const f of rawFiles) {
        const decoded = decodeDataUrl(String(f.dataUrl ?? ''));
        if (!decoded) continue;
        const name = s(f.name, 200) || 'attachment';
        const ext = (name.split('.').pop() ?? '').toLowerCase();
        await trx('vendor_files').insert({
          vendor_pk: row.pk,
          name,
          mime: MIME_BY_EXT[ext] ?? 'application/octet-stream',
          size: decoded.data.length,
          data: decoded.data,
        });
        files++;
      }
      report.vendors = (report.vendors ?? 0) + 1;
    }
    report.vendor_files = files;

    // Audit log (ids preserved)
    const logs = all(src, 'audit_logs').map((a) => ({
      id: Number(a.id),
      actor: s(a.actor, 100) || 'system',
      action: s(a.action, 100),
      entity_type: s(a.entity_type, 100),
      entity_id: s(a.entity_id, 250),
      details: String(a.details ?? '').slice(0, 5000),
      ip: s(a.ip, 100),
      created_at: ts(a.created_at),
    }));
    await chunkInsert(trx, 'audit_logs', logs);
    await trx.raw("select setval(pg_get_serial_sequence('audit_logs','id'), greatest((select coalesce(max(id),0) from audit_logs),1))");
    report.audit_logs = logs.length;

    await trx('audit_logs').insert({
      actor: 'system',
      action: 'import_d1',
      entity_type: 'database',
      entity_id: '',
      details: JSON.stringify({ file: file.split('/').pop(), report }),
    });

    if (DRY) throw Object.assign(new Error('DRY_RUN'), { dry: true });
  }).catch((err) => {
    if ((err as { dry?: boolean }).dry) {
      console.log('Dry run - nothing was written.');
      return;
    }
    throw err;
  });

  console.table(report);
  if (warnings.length) console.warn(`${warnings.length} warning(s):\n` + warnings.join('\n'));
}

main()
  .catch((err) => {
    console.error('Import failed - no data was written.\n', err);
    process.exitCode = 1;
  })
  .finally(() => Promise.allSettled([db.destroy(), redis.quit()]));

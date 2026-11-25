import { Router } from 'express';
import type { Knex } from 'knex';
import { z } from 'zod';
import { db } from '../db/knex.js';
import { audit } from '../lib/audit.js';
import { ah, badRequest, forbidden, HttpError, notFound } from '../lib/errors.js';
import { allowedCollege, canViewVendors, hasPerm, type PermUser } from '../lib/permissions.js';
import { rateLimit } from '../lib/rateLimit.js';
import { clean } from '../lib/text.js';
import { clientIp, type AuthedRequest } from '../middleware/auth.js';
import { voucherDto, type VoucherRow } from './vouchers.js';

export const vendorsRouter = Router();

export const MAX_FILES_PER_VENDOR = 3;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_BULK_VENDORS = 500;

/** Allowed attachment types, decided by extension. The stored MIME type always follows the extension. */
const FILE_TYPE_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

export interface VendorRow {
  pk: number;
  vendor_id: string;
  college: string;
  company_name: string;
  vendor_name: string;
  phone: string;
  pan: string;
  aadhaar: string;
  email: string;
  gst_number: string;
  bank_account_details: string;
  work_description: string;
  agreed_amount: string | number;
  amount_in_words: string;
  period_start: string;
  period_end: string;
  auth_by: string;
  auth_role: string;
  auth_place: string;
  remarks: string;
  extra: Record<string, unknown>;
  created_by: string;
  created_at: Date;
  updated_by: string | null;
  updated_at: Date;
  deleted_at: Date | null;
}

interface FileMeta {
  id: string;
  name: string;
  size: number;
  type: string;
}

export function vendorDto(v: VendorRow, files: FileMeta[]) {
  return {
    ...(v.extra ?? {}),
    vendorId: v.vendor_id,
    college: v.college,
    companyName: v.company_name,
    vendorName: v.vendor_name,
    phone: v.phone,
    pan: v.pan,
    aadhaar: v.aadhaar,
    email: v.email,
    gstNumber: v.gst_number,
    bankAccountDetails: v.bank_account_details,
    workDescription: v.work_description,
    agreedAmount: Number(v.agreed_amount),
    amountInWords: v.amount_in_words,
    periodStart: v.period_start,
    periodEnd: v.period_end,
    authBy: v.auth_by,
    authRole: v.auth_role,
    authPlace: v.auth_place,
    remarks: v.remarks,
    files,
    createdBy: v.created_by,
    createdAt: v.created_at,
    updatedBy: v.updated_by,
    updatedAt: v.updated_at,
  };
}

async function listVendors(college: string) {
  const rows = await db<VendorRow>('vendors')
    .whereNull('deleted_at')
    .andWhere({ college })
    .orderBy([{ column: 'vendor_id' }, { column: 'created_at', order: 'desc' }]);
  const files = rows.length
    ? await db('vendor_files')
        .whereIn('vendor_pk', rows.map((r) => r.pk))
        .orderBy('created_at')
        .select('id', 'vendor_pk', 'name', 'size', 'mime')
    : [];
  const byVendor = new Map<number, FileMeta[]>();
  for (const f of files) {
    const list = byVendor.get(Number(f.vendor_pk)) ?? [];
    list.push({ id: f.id, name: f.name, size: f.size, type: f.mime });
    byVendor.set(Number(f.vendor_pk), list);
  }
  return rows.map((r) => vendorDto(r, byVendor.get(Number(r.pk)) ?? []));
}

function needViewVendors(user: PermUser) {
  if (!canViewVendors(user)) throw forbidden('Access denied. Missing view_vendor_ledger permission.');
}
function needManageVendors(user: PermUser) {
  if (!hasPerm(user, 'manage_vendors')) throw forbidden('Access denied. Missing manage_vendors permission.');
}

vendorsRouter.get(
  '/',
  ah<AuthedRequest>(async (req, res) => {
    needViewVendors(req.user);
    res.json({ vendors: await listVendors(allowedCollege(req.user, req.query.college)) });
  }),
);

/**
 * Payments linked to vendors (any creator), for the vendor ledger and the voucher form's
 * "paid so far" figure. Users who may only see their own vouchers still get correct ledger totals.
 */
vendorsRouter.get(
  '/payments',
  ah<AuthedRequest>(async (req, res) => {
    needViewVendors(req.user);
    const college = allowedCollege(req.user, req.query.college);
    const rows = await db<VoucherRow>('vouchers')
      .whereNull('deleted_at')
      .andWhere({ college })
      .andWhereNot('vendor_id', '')
      .orderBy([{ column: 'date', order: 'desc' }, { column: 'id', order: 'desc' }]);
    res.json({ vouchers: rows.map((v) => voucherDto(v)) });
  }),
);

const s = (max: number) =>
  z
    .any()
    .optional()
    .transform((v) => clean(v, max));

/** Incoming file: either an existing attachment to keep ({id}) or a new upload ({name, dataUrl}). */
const FileInput = z.union([
  z.object({ id: z.string().uuid() }).passthrough(),
  z.object({ name: z.string().max(200), dataUrl: z.string() }).passthrough(),
]);

const VendorInput = z
  .object({
    vendorId: s(50),
    companyName: s(250),
    vendorName: s(250),
    phone: s(50),
    pan: s(50),
    aadhaar: s(50),
    email: s(120),
    gstNumber: s(50),
    bankAccountDetails: s(500),
    workDescription: s(1000),
    agreedAmount: z.coerce.number().optional().default(0),
    amountInWords: s(500),
    periodStart: s(30),
    periodEnd: s(30),
    authBy: s(120),
    authRole: s(120),
    authPlace: s(120),
    remarks: s(1000),
    files: z.array(FileInput).optional(),
  })
  .passthrough();

/** Legacy duplicate/snake_case keys the old UI stored alongside the real fields. */
export const VENDOR_ALIAS_KEYS = [
  'company',
  'name',
  'workDesc',
  'amount',
  'amtWords',
  'vendor_id',
  'created_at',
  'created_by',
  'updated_at',
  'updated_by',
  'deleted_at',
];

const KNOWN_KEYS = new Set([
  ...Object.keys(VendorInput.shape),
  ...VENDOR_ALIAS_KEYS,
  'college',
  'createdBy',
  'createdAt',
  'updatedBy',
  'updatedAt',
  'id',
  'pk',
]);

export function extraFields(v: Record<string, unknown>): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v)) {
    if (KNOWN_KEYS.has(k) || k === 'dataUrl') continue;
    if (typeof val === 'string' && val.startsWith('data:')) continue; // never store inline file data
    if (k === 'agreement' && val && typeof val === 'object' && !Array.isArray(val)) {
      const { files: _files, ...agreement } = val as Record<string, unknown>;
      extra[k] = agreement; // attachments live in vendor_files
      continue;
    }
    extra[k] = val;
  }
  const json = JSON.stringify(extra);
  if (json.length > 100_000) throw badRequest('Vendor record has too much extra data.');
  return extra;
}

function decodeUpload(f: { name: string; dataUrl: string }) {
  const name = clean(f.name, 200);
  const ext = (name.split('.').pop() ?? '').toLowerCase();
  const mime = FILE_TYPE_BY_EXT[ext];
  if (!mime) throw badRequest('Only PDF, Word (.doc/.docx), PNG and JPEG files can be attached');
  const m = /^data:([a-z0-9.+/-]*);base64,([A-Za-z0-9+/=]*)$/i.exec(f.dataUrl);
  const declared = m ? m[1].toLowerCase() : '';
  if (!m || (declared !== mime && declared !== 'application/octet-stream' && declared !== '')) {
    throw badRequest(`Attached file "${name}" does not match an allowed file type`);
  }
  const data = Buffer.from(m[2], 'base64');
  if (data.length > MAX_FILE_BYTES) throw new HttpError(413, `"${name}" is larger than 5 MB.`);
  return { name, mime, size: data.length, data };
}

export async function upsertVendor(
  trx: Knex.Transaction,
  user: PermUser,
  college: string,
  input: unknown,
  ip: string,
  { replaceFiles = true, createOnly = false } = {},
): Promise<string> {
  const v = VendorInput.parse(input);
  const vendorId = v.vendorId;
  if (!vendorId) throw badRequest('Vendor ID is required');
  if (!v.companyName && !v.vendorName) throw badRequest('Vendor/Company name is required');
  if (!Number.isFinite(v.agreedAmount) || v.agreedAmount < 0 || v.agreedAmount > 10_000_000_000) {
    throw badRequest('Agreed amount is out of range');
  }
  const cols = {
    company_name: v.companyName,
    vendor_name: v.vendorName,
    phone: v.phone,
    pan: v.pan,
    aadhaar: v.aadhaar,
    email: v.email,
    gst_number: v.gstNumber,
    bank_account_details: v.bankAccountDetails,
    work_description: v.workDescription,
    agreed_amount: v.agreedAmount,
    amount_in_words: v.amountInWords,
    period_start: v.periodStart,
    period_end: v.periodEnd,
    auth_by: v.authBy,
    auth_role: v.authRole,
    auth_place: v.authPlace || 'Chebrolu / Guntur',
    remarks: v.remarks,
    extra: JSON.stringify(extraFields(v)),
    updated_by: user.username,
    updated_at: new Date(),
  };

  const existing = await trx<VendorRow>('vendors').where({ college, vendor_id: vendorId }).whereNull('deleted_at').first();
  if (existing && createOnly) {
    throw new HttpError(409, `Vendor ID ${vendorId} already exists. Refresh to get the next free ID.`);
  }
  let pk: number;
  if (existing) {
    pk = existing.pk;
    await trx('vendors').where({ pk }).update(cols);
    await audit(user.username, 'update_vendor', 'vendor', vendorId, { company: v.companyName, amount: v.agreedAmount }, ip, trx);
  } else {
    const [row] = await trx('vendors')
      .insert({ ...cols, vendor_id: vendorId, college, created_by: user.username })
      .returning<{ pk: number }[]>('pk');
    pk = row.pk;
    await audit(user.username, 'create_vendor', 'vendor', vendorId, { company: v.companyName, amount: v.agreedAmount }, ip, trx);
  }

  if (replaceFiles && v.files) {
    if (v.files.length > MAX_FILES_PER_VENDOR) throw badRequest(`A vendor can have at most ${MAX_FILES_PER_VENDOR} attached files`);
    const keepIds = v.files.filter((f): f is { id: string } => 'id' in f && typeof f.id === 'string').map((f) => f.id);
    await trx('vendor_files').where({ vendor_pk: pk }).whereNotIn('id', keepIds).delete();
    for (const f of v.files) {
      if ('dataUrl' in f && typeof f.dataUrl === 'string' && !('id' in f && f.id)) {
        const up = decodeUpload(f as { name: string; dataUrl: string });
        await trx('vendor_files').insert({ vendor_pk: pk, ...up });
      }
    }
  }
  return vendorId;
}

const SaveBody = z.object({
  college: z.string().optional(),
  vendor: z.record(z.unknown()),
  /** true when the form is creating a new vendor: fail with 409 instead of overwriting an existing ID. */
  create: z.boolean().optional().default(false),
});

vendorsRouter.put(
  '/',
  ah<AuthedRequest>(async (req, res) => {
    needManageVendors(req.user);
    const body = SaveBody.parse(req.body);
    const college = allowedCollege(req.user, body.vendor.college ?? body.college);
    const vendorId = await db
      .transaction((trx) => upsertVendor(trx, req.user, college, body.vendor, clientIp(req), { createOnly: body.create }))
      .catch((err) => {
        // Two admins inserting the same new ID at once: the unique index catches the loser.
        if ((err as { code?: string }).code === '23505') throw new HttpError(409, 'That vendor ID was just taken. Refresh to get the next free ID.');
        throw err;
      });
    const vendor = (await listVendors(college)).find((v) => v.vendorId === vendorId);
    res.json({ ok: true, vendor });
  }),
);

const BulkBody = z.object({ college: z.string().optional(), vendors: z.array(z.record(z.unknown())).max(MAX_BULK_VENDORS) });

/** Excel import. Each vendor is saved independently; failures are reported, not fatal. Attachments are untouched. */
vendorsRouter.post(
  '/bulk',
  ah<AuthedRequest>(async (req, res) => {
    needManageVendors(req.user);
    await rateLimit(`vendorbulk:${req.user.username}`, 20, 3600);
    const body = BulkBody.parse(req.body);
    const college = allowedCollege(req.user, body.college);
    const failed: { vendorId: string; error: string }[] = [];
    let saved = 0;
    for (const v of body.vendors) {
      try {
        await db.transaction((trx) => upsertVendor(trx, req.user, college, v, clientIp(req), { replaceFiles: false }));
        saved++;
      } catch (err) {
        failed.push({ vendorId: clean(v.vendorId, 50), error: err instanceof HttpError ? err.message : 'Invalid vendor' });
      }
    }
    res.json({ ok: true, saved, failed });
  }),
);

vendorsRouter.delete(
  '/:vendorId',
  ah<AuthedRequest>(async (req, res) => {
    needManageVendors(req.user);
    const college = allowedCollege(req.user, req.query.college);
    const vendorId = clean(req.params.vendorId, 50);
    const n = await db('vendors')
      .where({ college, vendor_id: vendorId })
      .whereNull('deleted_at')
      .update({ deleted_at: new Date(), deleted_by: req.user.username });
    if (!n) throw notFound('Vendor not found');
    await audit(req.user.username, 'delete_vendor', 'vendor', vendorId, `Deleted vendor ${vendorId}`, clientIp(req));
    res.json({ ok: true });
  }),
);

vendorsRouter.get(
  '/:vendorId/files/:fileId',
  ah<AuthedRequest>(async (req, res) => {
    needViewVendors(req.user);
    const college = allowedCollege(req.user, req.query.college);
    const fileId = String(req.params.fileId);
    if (!/^[0-9a-f-]{36}$/i.test(fileId)) throw notFound('File not found');
    const file = await db('vendor_files as f')
      .join('vendors as v', 'v.pk', 'f.vendor_pk')
      .where({ 'f.id': fileId, 'v.vendor_id': clean(req.params.vendorId, 50), 'v.college': college })
      .whereNull('v.deleted_at')
      .first('f.name', 'f.mime', 'f.data');
    if (!file) throw notFound('File not found');
    const disposition = req.query.download ? 'attachment' : 'inline';
    res.setHeader('Content-Type', file.mime);
    res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    // MIME always comes from the allow-listed extension (never HTML/SVG); nosniff is set globally.
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'");
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(file.data);
  }),
);

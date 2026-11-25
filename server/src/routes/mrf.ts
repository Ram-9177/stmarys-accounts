import { createHash, timingSafeEqual } from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { db } from '../db/knex.js';
import { audit } from '../lib/audit.js';
import { ah, badRequest, HttpError } from '../lib/errors.js';
import type { PermUser } from '../lib/permissions.js';
import { clean, isoFromAny, isValidIsoDate, norm, normalizeCollegeCode } from '../lib/text.js';
import { clientIp } from '../middleware/auth.js';
import { findCampus } from '../uos/campusMap.js';
import {
  advancesForMrf,
  type AdvanceRow,
  cancelAdvance,
  markBillsFinal,
  MRF_ACTOR,
  planAdvance,
  today,
} from '../finance/advances.js';

/**
 * The link between Accounts' On Account and the MRF module (the goods line).
 * Hand-offs on the UOS flow maps:
 *   in   X2  advance.requested  the On Account route fixed at clearance (payee, amount, form, settle-by, who recovers)
 *   in   X3  order.issued / order.cancelled
 *   in   X13 vendor.marked      blacklisted, suspended or lifted
 *   out  X4  advance.paid, then advance.changed / advance.closed with the four figures
 *   read      the four figures for a case, a PO or a vendor, and whether advances block a case's closure (X12)
 * Server to server, with a shared secret in x-module-credential (the header UOS modules use for /sync).
 */
export const mrfRouter = Router();

const digest = (v: string) => createHash('sha256').update(v).digest();

function requireModuleCredential(req: Request, _res: Response, next: NextFunction) {
  if (!config.MRF_LINK_SECRET) return next(new HttpError(404, 'The MRF link is not set up on this server.'));
  const sent = String(req.headers['x-module-credential'] ?? '');
  if (!sent || !timingSafeEqual(digest(sent), digest(config.MRF_LINK_SECRET))) {
    return next(new HttpError(401, 'Module credential missing or wrong.'));
  }
  next();
}
mrfRouter.use(requireModuleCredential);

/** MRF acts as a system user: every college, every On Account act it is allowed (planning and stopping). */
const MRF_USER: PermUser & { username: string } = {
  username: MRF_ACTOR,
  role: 'admin',
  college: 'smgg',
  college_access: ['*'],
  permissions: ['*'],
};

// ------------------------------------------------------------------ inbound events

const str = (max: number) => z.any().optional().transform((v) => clean(v, max));
const date = z
  .any()
  .optional()
  .transform((v, ctx) => {
    const s = clean(v, 20);
    if (!s) return null;
    const iso = isoFromAny(s);
    if (!isValidIsoDate(iso)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'not a valid date' });
      return z.NEVER;
    }
    return iso;
  });

const Envelope = z.object({
  eventId: z.string().trim().min(1).max(200),
  type: z.enum(['advance.requested', 'order.issued', 'order.cancelled', 'vendor.marked']),
  data: z.record(z.unknown()).default({}),
});

const AdvanceRequested = z.object({
  college: str(20),
  campusId: str(80),
  case: str(80),
  po: str(80),
  clearanceRef: str(80),
  payee: z.object({
    kind: z.enum(['vendor', 'employee']),
    name: str(200),
    vendorCode: str(80),
    gst: str(20),
    phone: str(30),
    employeeRef: str(80),
  }),
  amount: z.coerce.number(),
  plannedForm: str(20),
  settleBy: date,
  recoveredBy: str(120),
  purpose: str(400),
});

const OrderIssued = z.object({ case: str(80), po: str(80), vendorCode: str(80), payeeName: str(200) });
const OrderCancelled = z.object({ po: str(80), reason: str(400) });
const VendorMarked = z.object({
  vendor: z.object({ code: str(80), name: str(200), gst: str(20) }),
  mark: z.enum(['blacklisted', 'suspended', 'lifted']),
  reason: str(400),
  details: str(2000),
  scopeColleges: z.array(z.string()).optional().default([]),
  scopeCampusIds: z.array(z.string()).optional().default([]),
  from: date,
  until: date,
  proposedBy: str(120),
  approvedBy: str(120),
});

/** The college whose books an MRF case is paid from: its code, or a UOS campus that holds exactly one college. */
async function collegeFor(college: string, campusId: string): Promise<string> {
  if (college) {
    const code = normalizeCollegeCode(college);
    const row = await db('colleges').where({ code, status: 'active' }).first();
    if (!row) throw badRequest(`Unknown or inactive college: ${college}`);
    return code;
  }
  if (campusId) {
    const campus = findCampus(config.uos.campuses, campusId);
    if (!campus) throw badRequest(`Campus ${campusId} is not mapped to colleges in Accounts (UOS_CAMPUS_MAP).`);
    if (campus.colleges.length !== 1) {
      throw badRequest(`Campus ${campus.name || campusId} keeps the books of ${campus.colleges.length} colleges; send "college" (${campus.colleges.join(', ')}).`);
    }
    return campus.colleges[0];
  }
  throw badRequest('Send "college" (or a campusId that holds one college).');
}

async function handle(type: z.infer<typeof Envelope>['type'], data: Record<string, unknown>, eventId: string, ip: string) {
  if (type === 'advance.requested') {
    const d = AdvanceRequested.parse(data);
    const college = await collegeFor(d.college, d.campusId);
    if (!d.case) throw badRequest('Send the case number (case).');
    const advance = await planAdvance(
      MRF_USER,
      {
        payeeKind: d.payee.kind,
        payeeName: d.payee.name,
        payeePhone: d.payee.phone,
        vendorCode: d.payee.vendorCode,
        vendorGst: d.payee.gst,
        employeeRef: d.payee.employeeRef,
        amount: d.amount,
        plannedForm: d.plannedForm,
        settleBy: d.settleBy ?? '',
        recoveredBy: d.recoveredBy,
        purpose: d.purpose,
        caseNo: d.case,
        poNo: d.po,
        clearanceRef: d.clearanceRef,
      },
      ip,
      { source: 'mrf', eventId, college },
    );
    return { advanceNo: advance.advanceNo, state: advance.state };
  }

  if (type === 'order.issued') {
    const d = OrderIssued.parse(data);
    if (!d.case || !d.po) throw badRequest('Send the case and the po.');
    const linked = await db.transaction(async (trx) => {
      const rows: AdvanceRow[] = await trx<AdvanceRow>('advances')
        .whereRaw('lower(case_no) = lower(?)', [d.case])
        .andWhere({ po_no: '' })
        .whereNot({ status: 'cancelled' })
        .modify((q) => {
          if (d.vendorCode) q.whereRaw('lower(vendor_code) = lower(?)', [d.vendorCode]);
          else if (d.payeeName) q.whereRaw('lower(payee_name) = ?', [norm(d.payeeName)]);
        })
        .forUpdate();
      for (const a of rows) {
        await trx('advances').where({ id: a.id }).update({ po_no: d.po, updated_at: new Date() });
        await trx('advance_log').insert({ advance_id: a.id, actor: MRF_ACTOR, action: 'po_linked', details: JSON.stringify({ po: d.po }) });
      }
      return rows.map((a) => a.advance_no);
    });
    return { linked };
  }

  if (type === 'order.cancelled') {
    const d = OrderCancelled.parse(data);
    if (!d.po) throw badRequest('Send the po.');
    const reason = d.reason || `Order ${d.po} cancelled in MRF`;
    const rows: AdvanceRow[] = await db<AdvanceRow>('advances').whereRaw('lower(po_no) = lower(?)', [d.po]).whereNot({ status: 'cancelled' });
    const cancelled: string[] = [];
    const toRecover: string[] = [];
    for (const a of rows) {
      if (a.status === 'paid') {
        // F7: "Cancel: frees the budget. An advance already paid stays to be recovered."
        if (!a.closed_on) {
          await markBillsFinal(MRF_USER, Number(a.id), ip, MRF_ACTOR, reason);
          toRecover.push(a.advance_no ?? '');
        }
      } else {
        await cancelAdvance(MRF_USER, Number(a.id), reason, ip, MRF_ACTOR);
        cancelled.push(a.advance_no ?? '');
      }
    }
    return { cancelled, toRecover };
  }

  // vendor.marked (X13)
  const d = VendorMarked.parse(data);
  if (!d.vendor.code && !d.vendor.name && !d.vendor.gst) throw badRequest('Send the vendor (code, name or gst).');
  const match = (q: ReturnType<typeof db>) =>
    q.andWhere((w) => {
      if (d.vendor.code) w.orWhereRaw('lower(vendor_code) = lower(?)', [d.vendor.code]);
      if (d.vendor.gst) w.orWhereRaw('upper(vendor_gst) = upper(?)', [d.vendor.gst]);
      if (!d.vendor.code && !d.vendor.gst) w.orWhereRaw('lower(vendor_name) = ?', [norm(d.vendor.name)]);
    });
  return db.transaction(async (trx) => {
    // One live mark per vendor: a new mark or a lift ends the one before.
    const lifted = await match(trx('vendor_marks').whereNull('lifted_at')).update({ lifted_at: new Date(), lifted_by: d.approvedBy || MRF_ACTOR, updated_at: new Date() });
    if (d.mark === 'lifted') return { lifted };
    const scope = new Set(d.scopeColleges.map(normalizeCollegeCode).filter(Boolean));
    for (const id of d.scopeCampusIds) findCampus(config.uos.campuses, id)?.colleges.forEach((c) => scope.add(c));
    await trx('vendor_marks').insert({
      vendor_code: d.vendor.code,
      vendor_name: d.vendor.name,
      vendor_gst: d.vendor.gst.toUpperCase(),
      mark: d.mark,
      reason: d.reason,
      details: d.details,
      scope_colleges: [...scope],
      from_date: d.from ?? today(),
      until_date: d.mark === 'suspended' ? d.until : null,
      proposed_by: d.proposedBy,
      approved_by: d.approvedBy,
      source_event_id: eventId,
    });
    await audit(MRF_ACTOR, 'vendor_marked', 'vendor', d.vendor.code || d.vendor.name, { mark: d.mark, reason: d.reason }, ip, trx);
    return { marked: d.mark, replaced: lifted };
  });
}

mrfRouter.post(
  '/events',
  ah(async (req, res) => {
    const env = Envelope.parse(req.body);
    const ip = clientIp(req);
    // Claim the event id first, so two deliveries of one event never both act.
    const claimed = await db('mrf_inbox')
      .insert({ event_id: env.eventId, event_type: env.type, result: JSON.stringify({ processing: true }) })
      .onConflict('event_id')
      .ignore()
      .returning('event_id');
    if (!claimed.length) {
      const prior = await db('mrf_inbox').where({ event_id: env.eventId }).first();
      if (prior?.result?.processing) {
        // A claim left behind by a crash is freed after five minutes, so the event can be sent again.
        if (Date.now() - new Date(prior.received_at).getTime() > 5 * 60_000) {
          await db('mrf_inbox').where({ event_id: env.eventId }).delete();
        }
        throw new HttpError(409, 'This event is still being processed. Send it again shortly.');
      }
      res.json({ ok: true, duplicate: true, eventId: env.eventId, result: prior?.result ?? {} });
      return;
    }
    try {
      const result = await handle(env.type, env.data, env.eventId, ip);
      await db('mrf_inbox').where({ event_id: env.eventId }).update({ result: JSON.stringify(result) });
      res.status(201).json({ ok: true, eventId: env.eventId, result });
    } catch (err) {
      // Not done: free the id so MRF can send it again once the cause is fixed.
      await db('mrf_inbox').where({ event_id: env.eventId }).delete();
      throw err;
    }
  }),
);

// ------------------------------------------------------------------ outbound: the event feed MRF polls

mrfRouter.get(
  '/events',
  ah(async (req, res) => {
    const after = Math.max(0, Number(req.query.after ?? 0) || 0);
    const limit = Math.min(500, Math.max(1, Number(req.query.limit ?? 200) || 200));
    const rows = await db('mrf_outbox').where('id', '>', after).orderBy('id').limit(limit + 1);
    const page = rows.slice(0, limit);
    res.json({
      events: page.map((r) => ({
        id: Number(r.id),
        type: r.event_type,
        advanceNo: r.advance_no,
        case: r.case_no || null,
        createdAt: r.created_at,
        data: r.payload,
      })),
      next: page.length ? Number(page[page.length - 1].id) : after,
      hasMore: rows.length > limit,
    });
  }),
);

// ------------------------------------------------------------------ read: the four figures

mrfRouter.get(
  '/advances',
  ah(async (req, res) => {
    const filter = { case: clean(req.query.case, 80), po: clean(req.query.po, 80), vendor: clean(req.query.vendor, 80) };
    if (!filter.case && !filter.po && !filter.vendor) throw badRequest('Filter by case, po or vendor.');
    res.json({ advances: await advancesForMrf(filter) });
  }),
);

/** X12: the money side of a case cannot close while an advance on it is still out. */
mrfRouter.get(
  '/cases/:caseNo/financial-status',
  ah(async (req, res) => {
    const caseNo = clean(req.params.caseNo, 80);
    const advances = await advancesForMrf({ case: caseNo });
    const open = advances.filter((a) => a.blocksClosure || a.state === 'planned' || a.state === 'prepared');
    res.json({
      case: caseNo,
      advances,
      open: open.map((a) => ({
        advanceNo: a.advanceNo,
        state: a.state,
        outstanding: a.outstanding,
        toRecover: a.toRecover,
        dueDate: a.dueDate,
        why: a.state === 'planned' || a.state === 'prepared' ? 'advance not yet paid' : a.toRecover > 0 ? `recover ₹${a.toRecover}` : `₹${a.outstanding} still with the payee`,
      })),
      advancesClosed: open.length === 0,
    });
  }),
);

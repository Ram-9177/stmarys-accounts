import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/knex.js';
import { audit } from '../lib/audit.js';
import { ah, badRequest, HttpError, notFound } from '../lib/errors.js';
import { need } from '../lib/permissions.js';
import { clean } from '../lib/text.js';
import { clientIp, requireAuth, type AuthedRequest } from '../middleware/auth.js';

export const collegesRouter = Router();
export const auditRouter = Router();

const COLLEGE_COLUMNS = ['code', 'name', 'location', 'logo_url as logoUrl', 'status', 'created_by as createdBy', 'created_at as createdAt', 'updated_at as updatedAt'];
const listColleges = () => db('colleges').select(COLLEGE_COLUMNS).orderBy('name');

/** Public: the campus picker shown before sign-in. */
collegesRouter.get(
  '/public',
  ah(async (_req, res) => {
    res.json({ colleges: await db('colleges').where({ status: 'active' }).select('code', 'name', 'location', 'logo_url as logoUrl').orderBy('code') });
  }),
);

collegesRouter.get(
  '/',
  requireAuth({ allowPasswordChange: true }),
  ah(async (_req, res) => {
    res.json({ colleges: await listColleges() });
  }),
);

const CreateCollege = z.object({
  name: z.string(),
  code: z.string().optional(),
  location: z.string().optional(),
  logoUrl: z.string().optional(),
});
const codeOf = (v: unknown) => clean(v, 80).toLowerCase().replace(/[^a-z0-9_-]/g, '');

collegesRouter.post(
  '/',
  requireAuth(),
  ah<AuthedRequest>(async (req, res) => {
    need(req.user, 'manage_colleges');
    const body = CreateCollege.parse(req.body);
    const name = clean(body.name, 160);
    const code = codeOf(body.code || name);
    const location = clean(body.location, 160);
    const logoUrl = clean(body.logoUrl, 500);
    if (!name) throw badRequest('College name required');
    if (code.length < 2 || code.length > 20) throw badRequest('College code must be 2-20 characters');
    if (logoUrl && !/^(https:\/\/|\/|assets\/)/i.test(logoUrl)) throw badRequest('Logo URL must be an https:// link or a site path');
    if (await db('colleges').where({ code }).first()) throw new HttpError(409, 'College code already exists');
    await db('colleges').insert({ code, name, location, logo_url: logoUrl, status: 'active', created_by: req.user.username });
    await audit(req.user.username, 'create_college', 'college', code, { name, location }, clientIp(req));
    res.status(201).json({ colleges: await listColleges() });
  }),
);

const StatusBody = z.object({ status: z.enum(['active', 'inactive']) });

collegesRouter.patch(
  '/:code/status',
  requireAuth(),
  ah<AuthedRequest>(async (req, res) => {
    need(req.user, 'manage_colleges');
    const code = codeOf(req.params.code);
    const { status } = StatusBody.parse(req.body);
    if (code === 'smgg') throw badRequest('Main college cannot be disabled');
    const n = await db('colleges').where({ code }).update({ status, updated_at: new Date() });
    if (!n) throw notFound('College not found');
    await audit(req.user.username, 'set_college_status', 'college', code, status, clientIp(req));
    res.json({ colleges: await listColleges() });
  }),
);

const AuditQuery = z.object({
  limit: z.coerce.number().int().min(1).max(5000).optional().default(2000),
  before: z.coerce.number().int().positive().optional(),
  actor: z.string().max(100).optional(),
  action: z.string().max(100).optional(),
});

auditRouter.get(
  '/',
  ah<AuthedRequest>(async (req, res) => {
    need(req.user, 'view_audit');
    const q = AuditQuery.parse(req.query);
    const query = db('audit_logs')
      .select('id', 'actor', 'action', 'entity_type as entityType', 'entity_id as entityId', 'details', 'ip', 'created_at as createdAt')
      .orderBy([{ column: 'created_at', order: 'desc' }, { column: 'id', order: 'desc' }])
      .limit(q.limit);
    if (q.before) query.where('id', '<', q.before);
    if (q.actor) query.where('actor', q.actor);
    if (q.action) query.where('action', q.action);
    res.json({ logs: await query });
  }),
);

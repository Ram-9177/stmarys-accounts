import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/knex.js';
import { audit } from '../lib/audit.js';
import { ah, badRequest } from '../lib/errors.js';
import { allowedCollege, need } from '../lib/permissions.js';
import { clean, norm } from '../lib/text.js';
import { clientIp, type AuthedRequest } from '../middleware/auth.js';

/** Account heads and blocks: per-college pick lists used by the voucher form. */
export const headsRouter = Router();
export const blocksRouter = Router();

const listHeads = (college: string) =>
  db('account_heads').where({ college, active: true }).orderBy('name').select('id', 'name', 'type', 'college', 'created_by', 'created_at');
const listBlocks = (college: string) =>
  db('blocks').where({ college, active: true }).orderBy('name').select('id', 'name', 'college', 'created_by', 'created_at');

headsRouter.get(
  '/',
  ah<AuthedRequest>(async (req, res) => {
    res.json({ heads: await listHeads(allowedCollege(req.user, req.query.college)) });
  }),
);

const HeadBody = z.object({
  name: z.string(),
  type: z.enum(['debit', 'onaccount', 'credit', 'common']).optional().default('common'),
  college: z.string().optional(),
});

headsRouter.post(
  '/',
  ah<AuthedRequest>(async (req, res) => {
    need(req.user, 'account_heads');
    const body = HeadBody.parse(req.body);
    const name = clean(body.name, 250);
    if (!name) throw badRequest('Head name required');
    const college = allowedCollege(req.user, body.college);
    await db('account_heads')
      .insert({ name, name_norm: norm(name), type: body.type, college, created_by: req.user.username, active: true })
      .onConflict(['name_norm', 'college'])
      .ignore();
    await audit(req.user.username, 'add_account_head', 'account_head', name, { type: body.type, college }, clientIp(req));
    res.status(201).json({ heads: await listHeads(college) });
  }),
);

blocksRouter.get(
  '/',
  ah<AuthedRequest>(async (req, res) => {
    res.json({ blocks: await listBlocks(allowedCollege(req.user, req.query.college)) });
  }),
);

const BlockBody = z.object({ name: z.string(), college: z.string().optional() });

blocksRouter.post(
  '/',
  ah<AuthedRequest>(async (req, res) => {
    need(req.user, 'account_heads');
    const body = BlockBody.parse(req.body);
    const name = clean(body.name, 250);
    if (!name) throw badRequest('Block name required');
    const college = allowedCollege(req.user, body.college);
    await db('blocks')
      .insert({ name, name_norm: norm(name), college, created_by: req.user.username, active: true })
      .onConflict(['name_norm', 'college'])
      .ignore();
    await audit(req.user.username, 'add_block', 'block', name, { college }, clientIp(req));
    res.status(201).json({ blocks: await listBlocks(college) });
  }),
);

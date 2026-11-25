import { Router } from 'express';
import { ah, badRequest } from '../lib/errors.js';
import { clientIp, type AuthedRequest } from '../middleware/auth.js';
import {
  approveAdvance,
  cancelAdvance,
  getAdvance,
  listAdvances,
  markBillsFinal,
  planAdvance,
  prepareAdvance,
  recordReturn,
  returnForChanges,
  setOffBill,
} from '../finance/advances.js';
import { config } from '../config.js';

/** On Account advances (Finance flow F2, MRF flow B4). Every rule lives in finance/advances.ts. */
export const advancesRouter = Router();

const idOf = (v: unknown) => {
  const id = Number(v);
  if (!Number.isInteger(id) || id <= 0) throw badRequest('Invalid advance id');
  return id;
};

advancesRouter.get(
  '/settings',
  ah<AuthedRequest>(async (_req, res) => {
    res.json({
      employeeDays: config.ADVANCE_EMPLOYEE_DAYS,
      limits: { Cash: config.ADVANCE_CASH_LIMIT, UPI: config.ADVANCE_UPI_LIMIT, Card: config.ADVANCE_CARD_LIMIT },
      highLimit: config.ADVANCE_HIGH_LIMIT,
      approval: config.ADVANCE_APPROVAL,
    });
  }),
);

advancesRouter.get(
  '/',
  ah<AuthedRequest>(async (req, res) => {
    res.json(await listAdvances(req.user, req.query));
  }),
);

advancesRouter.get(
  '/:id',
  ah<AuthedRequest>(async (req, res) => {
    res.json({ advance: await getAdvance(req.user, idOf(req.params.id)) });
  }),
);

advancesRouter.post(
  '/',
  ah<AuthedRequest>(async (req, res) => {
    res.status(201).json({ advance: await planAdvance(req.user, req.body ?? {}, clientIp(req)) });
  }),
);

advancesRouter.post(
  '/:id/prepare',
  ah<AuthedRequest>(async (req, res) => {
    res.json({ advance: await prepareAdvance(req.user, idOf(req.params.id), req.body ?? {}, clientIp(req)) });
  }),
);

advancesRouter.post(
  '/:id/approve',
  ah<AuthedRequest>(async (req, res) => {
    res.json({ advance: await approveAdvance(req.user, idOf(req.params.id), req.body ?? {}, clientIp(req)) });
  }),
);

advancesRouter.post(
  '/:id/send-back',
  ah<AuthedRequest>(async (req, res) => {
    res.json({ advance: await returnForChanges(req.user, idOf(req.params.id), req.body?.reason, clientIp(req)) });
  }),
);

advancesRouter.post(
  '/:id/cancel',
  ah<AuthedRequest>(async (req, res) => {
    res.json({ advance: await cancelAdvance(req.user, idOf(req.params.id), req.body?.reason, clientIp(req)) });
  }),
);

advancesRouter.post(
  '/:id/set-off',
  ah<AuthedRequest>(async (req, res) => {
    res.json({ advance: await setOffBill(req.user, idOf(req.params.id), req.body ?? {}, clientIp(req)) });
  }),
);

advancesRouter.post(
  '/:id/return',
  ah<AuthedRequest>(async (req, res) => {
    res.json({ advance: await recordReturn(req.user, idOf(req.params.id), req.body ?? {}, clientIp(req)) });
  }),
);

advancesRouter.post(
  '/:id/bills-final',
  ah<AuthedRequest>(async (req, res) => {
    res.json({ advance: await markBillsFinal(req.user, idOf(req.params.id), clientIp(req)) });
  }),
);

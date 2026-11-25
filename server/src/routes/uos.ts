import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { audit } from '../lib/audit.js';
import { ah, HttpError } from '../lib/errors.js';
import { readHits, recordHit } from '../lib/rateLimit.js';
import { clearAuthCookies } from '../lib/tokens.js';
import { publicUser } from '../lib/users.js';
import { clientIp } from '../middleware/auth.js';
import { resolveForHandoff, sessionInfo } from '../uos/identity.js';
import { verifyModulePass } from '../uos/pass.js';
import { assertNotRevoked } from '../uos/revocation.js';
import { clearUosCookie, setUosCookie } from '../uos/session.js';

/**
 * Entry from the UOS shell.
 *
 * The shell opens Accounts with a module pass in the URL (the handoff). The web
 * app takes it out of the address bar and posts it here once; the server checks
 * it, links the person to their Accounts user and keeps the pass in an httpOnly
 * cookie for the rest of the session.
 */
export const uosRouter = Router();

const HANDOFF_WINDOW = 15 * 60;

function requireUos() {
  if (!config.uos.enabled) throw new HttpError(404, 'UOS sign-in is not enabled on this server.');
}

/** Public: what the web app needs to send people to and from the shell. */
uosRouter.get('/config', (_req, res) => {
  const u = config.uos;
  res.json(
    u.enabled
      ? {
          enabled: true,
          moduleId: u.moduleId,
          shellUrl: u.shellUrl,
          logoutUrl: u.shellUrl + (u.shellLogoutPath || '/'),
          legacyLogin: u.legacyLogin,
          accentColor: u.accentColor || null,
          campuses: u.campuses.map((c) => ({ campusId: c.campusId, code: c.code, name: c.name, colleges: c.colleges })),
        }
      : { enabled: false, accentColor: u.accentColor || null },
  );
});

const HandoffBody = z.object({ pass: z.string().min(20).max(16_384) });

uosRouter.post(
  '/handoff',
  ah(async (req, res) => {
    requireUos();
    const ip = clientIp(req);
    const ipKey = `uos-handoff-ip:${ip}`;
    // Generous: a whole campus may share one public IP. Only failures count.
    if ((await readHits(ipKey)) >= 300) throw new HttpError(429, 'Too many failed attempts. Please wait 15 minutes and try again.');
    try {
      const { pass } = HandoffBody.parse(req.body);
      const claims = verifyModulePass(pass);
      await assertNotRevoked(claims);
      const ctx = await resolveForHandoff(claims, ip);
      clearAuthCookies(res); // a UOS session replaces any password session in this browser
      setUosCookie(res, pass, claims.exp);
      await audit(ctx.user.username, 'login', 'user', ctx.user.username, { via: 'uos', campus: ctx.campus.campusId, link: ctx.how }, ip);
      res.json({ user: await publicUser(ctx.user), uos: sessionInfo(ctx) });
    } catch (err) {
      if (err instanceof HttpError && err.status < 500 && !(err.extra && err.extra.pending)) {
        await recordHit(ipKey, HANDOFF_WINDOW);
        await audit('uos', 'login_failed', 'user', '', { via: 'uos', reason: err.message }, ip);
      }
      throw err;
    }
  }),
);

/** Leaves Accounts (the UOS session itself is ended in the shell). */
uosRouter.post('/logout', (_req, res) => {
  clearUosCookie(res);
  clearAuthCookies(res);
  res.json({ ok: true, logoutUrl: config.uos.enabled ? config.uos.shellUrl + (config.uos.shellLogoutPath || '/') : '' });
});

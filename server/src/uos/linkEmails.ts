import { config } from '../config.js';
import { db } from '../db/knex.js';
import { audit } from '../lib/audit.js';

/**
 * UOS_LINK_EMAILS: gives existing users (e.g. the main administrators) their
 * UOS email at start-up, so they are linked the first time they open Accounts
 * from UOS without needing a password sign-in first. Only fills empty emails,
 * never overwrites one an admin set, and skips emails another user already has.
 */
export async function applyLinkEmails(): Promise<string[]> {
  const done: string[] = [];
  for (const { username, email } of config.uos.linkEmails) {
    const user = await db('users').where({ username }).first();
    if (!user || user.email) continue;
    const taken = await db('users').whereRaw('lower(email) = ?', [email]).first();
    if (taken) {
      console.warn(`UOS_LINK_EMAILS: ${email} already belongs to ${taken.username}; not given to ${username}`);
      continue;
    }
    await db('users').where({ username }).update({ email, updated_at: new Date() });
    await audit('system', 'uos_link_email', 'user', username, { email }, '');
    done.push(username);
  }
  return done;
}

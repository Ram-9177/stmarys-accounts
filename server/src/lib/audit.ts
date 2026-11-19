import type { Knex } from 'knex';
import { db } from '../db/knex.js';

export async function audit(
  actor: string,
  action: string,
  entityType: string,
  entityId: string,
  details: unknown,
  ip: string,
  trx: Knex | Knex.Transaction = db,
): Promise<void> {
  await trx('audit_logs').insert({
    actor: actor || 'system',
    action,
    entity_type: entityType,
    entity_id: entityId || '',
    details: typeof details === 'string' ? details : JSON.stringify(details ?? ''),
    ip: ip || '',
  });
}

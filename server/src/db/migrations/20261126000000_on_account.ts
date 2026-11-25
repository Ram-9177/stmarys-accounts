import type { Knex } from 'knex';

/**
 * On Account, as Finance flow F2 and MRF flow B4 describe it: money first,
 * goods later, then settle.
 *
 * An advance is planned (at clearance, from MRF or in Accounts), prepared with
 * its form of payment, approved by a second person and only then paid; paying
 * writes the On Account voucher. It is then set against bills, or the unspent
 * money is returned, until nothing is outstanding. Past its settle-by date, or
 * once all its bills are in, whatever is left is "to recover".
 *
 * mrf_outbox is a transactional outbox the MRF module polls (hand-off X4 and the
 * four figures it reads); mrf_inbox makes MRF's events idempotent.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('advances', (t) => {
    t.bigIncrements('id').primary();
    t.text('advance_no').unique();
    t.text('college').notNullable();
    // Payment lifecycle; how far it is settled is worked out from advance_settlements.
    t.text('status').notNullable().defaultTo('planned');
    t.text('payee_kind').notNullable();
    t.text('payee_name').notNullable();
    t.text('payee_phone').notNullable().defaultTo('');
    /** The Accounts vendor (V00012), when the advance is linked to one. */
    t.text('vendor_id').notNullable().defaultTo('');
    /** The vendor's code in MRF / UOS, when known. */
    t.text('vendor_code').notNullable().defaultTo('');
    t.text('vendor_gst').notNullable().defaultTo('');
    t.text('employee_ref').notNullable().defaultTo('');
    t.bigInteger('amount').notNullable();
    t.text('planned_form').notNullable().defaultTo('');
    t.text('form').notNullable().defaultTo('');
    t.text('reference').notNullable().defaultTo('');
    t.text('bank').notNullable().defaultTo('');
    t.text('received_by').notNullable().defaultTo('');
    t.date('settle_by');
    t.text('recovered_by').notNullable().defaultTo('');
    t.text('purpose').notNullable().defaultTo('');
    t.text('head').notNullable().defaultTo('On Account');
    t.text('block').notNullable().defaultTo('');
    t.text('case_no').notNullable().defaultTo('');
    t.text('po_no').notNullable().defaultTo('');
    t.text('clearance_ref').notNullable().defaultTo('');
    t.text('source').notNullable().defaultTo('accounts');
    t.text('source_event_id');
    t.boolean('bills_final').notNullable().defaultTo(false);
    t.timestamp('bills_final_at', { useTz: true });
    t.text('bills_final_by');
    t.text('planned_by');
    t.timestamp('planned_at', { useTz: true });
    t.text('prepared_by');
    t.timestamp('prepared_at', { useTz: true });
    t.text('approved_by');
    t.timestamp('approved_at', { useTz: true });
    t.date('paid_date');
    t.text('return_reason').notNullable().defaultTo('');
    t.text('cancelled_by');
    t.timestamp('cancelled_at', { useTz: true });
    t.text('cancel_reason').notNullable().defaultTo('');
    t.bigInteger('voucher_id').unique().references('id').inTable('vouchers');
    t.date('closed_on');
    t.timestamp('overdue_notified_at', { useTz: true });
    t.text('remarks').notNullable().defaultTo('');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.check("status in ('planned','prepared','paid','cancelled')");
    t.check("payee_kind in ('vendor','employee')");
    t.check("source in ('accounts','mrf','legacy')");
    t.check('amount > 0');
    t.index(['college', 'status']);
    t.index(['case_no']);
    t.index(['po_no']);
  });
  await knex.raw('CREATE INDEX advances_vendor_code ON advances (vendor_code) WHERE vendor_code <> \'\'');
  await knex.raw('CREATE INDEX advances_payee ON advances (lower(payee_name))');

  await knex.schema.createTable('advance_settlements', (t) => {
    t.bigIncrements('id').primary();
    t.bigInteger('advance_id').notNullable().references('id').inTable('advances').onDelete('CASCADE');
    /** bill: set against a bill · returned: unspent money returned or refunded · legacy_clear: cleared before settlements were tracked */
    t.text('kind').notNullable();
    t.text('bill_no').notNullable().defaultTo('');
    t.date('bill_date');
    t.bigInteger('bill_total');
    /** The payee a bill belongs to (vendor code, Accounts vendor or name), for the "never above the bill" check across advances. */
    t.text('bill_key').notNullable().defaultTo('');
    t.bigInteger('amount').notNullable();
    t.date('date').notNullable();
    t.text('form').notNullable().defaultTo('');
    t.text('reference').notNullable().defaultTo('');
    t.bigInteger('receipt_voucher_id').references('id').inTable('vouchers');
    t.text('notes').notNullable().defaultTo('');
    t.text('created_by').notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.check("kind in ('bill','returned','legacy_clear')");
    t.check('amount > 0');
    t.index(['advance_id']);
  });
  // A bill is set against an advance at most once.
  await knex.raw("CREATE UNIQUE INDEX advance_settlements_bill_once ON advance_settlements (advance_id, lower(bill_no)) WHERE kind = 'bill'");
  await knex.raw("CREATE INDEX advance_settlements_bill_key ON advance_settlements (bill_key, lower(bill_no)) WHERE kind = 'bill'");

  await knex.schema.createTable('advance_log', (t) => {
    t.bigIncrements('id').primary();
    t.bigInteger('advance_id').notNullable().references('id').inTable('advances').onDelete('CASCADE');
    t.timestamp('at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.text('actor').notNullable();
    t.text('action').notNullable();
    t.jsonb('details').notNullable().defaultTo('{}');
    t.index(['advance_id', 'at']);
  });

  /** Blacklisted or suspended vendors, from MRF (hand-off X13). No new advance goes to them. */
  await knex.schema.createTable('vendor_marks', (t) => {
    t.bigIncrements('id').primary();
    t.text('vendor_code').notNullable().defaultTo('');
    t.text('vendor_name').notNullable().defaultTo('');
    t.text('vendor_gst').notNullable().defaultTo('');
    t.text('mark').notNullable();
    t.text('reason').notNullable().defaultTo('');
    t.text('details').notNullable().defaultTo('');
    /** Colleges the mark applies to; empty = every college. */
    t.specificType('scope_colleges', 'text[]').notNullable().defaultTo('{}');
    t.date('from_date');
    /** A suspension's end; empty = until lifted. */
    t.date('until_date');
    t.text('proposed_by').notNullable().defaultTo('');
    t.text('approved_by').notNullable().defaultTo('');
    t.timestamp('lifted_at', { useTz: true });
    t.text('lifted_by');
    t.text('source_event_id');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.check("mark in ('blacklisted','suspended')");
  });

  /** Events for the MRF module, written in the same transaction as the change (X4 and the four figures). */
  await knex.schema.createTable('mrf_outbox', (t) => {
    t.bigIncrements('id').primary();
    t.text('event_type').notNullable();
    t.text('advance_no').notNullable().defaultTo('');
    t.text('case_no').notNullable().defaultTo('');
    t.jsonb('payload').notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  /** Events received from MRF, by their id: a repeated delivery gets the first answer back. */
  await knex.schema.createTable('mrf_inbox', (t) => {
    t.text('event_id').primary();
    t.text('event_type').notNullable();
    t.jsonb('result').notNullable().defaultTo('{}');
    t.timestamp('received_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  // Whoever could make On Account vouchers keeps making them, now as advances to be approved.
  await knex.raw(
    `UPDATE users SET permissions = array_append(permissions, 'manage_advances')
      WHERE permissions IS NOT NULL AND 'create_voucher' = ANY(permissions) AND NOT ('manage_advances' = ANY(permissions))`,
  );
}

export async function down(knex: Knex): Promise<void> {
  for (const t of ['mrf_inbox', 'mrf_outbox', 'vendor_marks', 'advance_log', 'advance_settlements', 'advances']) {
    await knex.schema.dropTableIfExists(t);
  }
}

# On Account, joined to MRF and Finance

**For:** Devendra (MRF), Raman (Finance), Nihal (platform) and Sri.

**What this is:** Sri's On Account build, studied and written in the form of the
UOS flow maps, and joined to them. It is flow **F2** on the Finance map and **B4**
on the MRF map: *"On Account: money first, goods later, then settle"*. It is built
in Accounts on branch `UOS-on_account`.

Both maps carried the line *"Waiting: Sri's existing On Account build. Once
shared, its logic is merged here and into Finance."* This document is that
merge.

---

## 1. What changed from the old On Account voucher

| Before | Now |
|---|---|
| An On Account voucher was paid the moment it was saved | An advance is **planned**, **prepared** with its form of payment and reference, **approved by a second person**, and only then paid. Paying writes the On Account voucher |
| One date: pending or cleared | The four figures MRF reads: **given, settled, to recover, due date** |
| Cleared by typing a "reverse / cleared date" | Settled by **setting it against bills** or recording the **money returned**. The voucher shows Cleared when nothing is left |
| No link to a purchase | Linked to the **MRF case** and **PO**, the **vendor** (with MRF's code) or the **employee** |
| No due date | A **settle-by** date: an employee's defaults to 15 days. Past it, the money still out is **to recover** |
| Nothing stopped a new advance | **"Recover ₹x"** blocks that person's next advance. A **blacklisted or suspended vendor** gets no advance |

Old On Account vouchers, and any imported from the Cloudflare app, become
advances automatically. A cleared one is closed on its cleared date. A pending
one stays with its payee, with no due date.

## 2. The flow, step by step

| # | Who | Does | What comes out | Hand-off |
|---|---|---|---|---|
| 1 | Finance (at clearance) | Fixes the payee, the amount, the form, the date to settle by and who recovers | A **planned** advance on the case. From MRF it arrives as `advance.requested`; in Accounts it is *New advance* | X2 |
| 2 | Finance Officer | Prepares the payment: the form, and its reference (UTR, cheque number and bank, or who receives the cash) | **Waiting for approval**. Not more than was cleared. Cash at most ₹10,000, UPI ₹1,00,000, card ₹2,00,000 | |
| 3 | Second approver | Approves. Above ₹2,00,000 a main administrator or a Head approves | **Paid.** The On Account voucher is written (cash book, voucher list, print). "Advance with vendor" or "With employee". No bill is marked paid | X4 |
| 4 | Vendor / employee | Supplies; the bills come | — | |
| 5 | Finance Officer | Sets the advance against each bill | Never above the advance or the bill, never twice, the same vendor only | |
| 6 | UOS | The settle-by date passes, or the Finance Officer marks *All bills in* | **"Recover ₹x"**. It blocks the case's closure and that person's next advance | |
| 7 | Finance Officer | Records the money returned (cash or refund) | A receipt voucher in the cash book. When nothing is left: **Settled**, and the voucher shows Cleared | |

The approver can also **send it back** with a reason (the ball returns to the
Finance Officer). A plan can be **cancelled** with a reason until it is paid.

## 3. Rules

- **Two kinds.** To a vendor: settled against that vendor's bills. To an employee: bills in and unspent cash back in 15 days (`ADVANCE_EMPLOYEE_DAYS`), and their phone number is required.
- **Second person.** Whoever prepared a payment cannot approve it. Approving needs `approve_advances`; preparing and settling need `manage_advances`.
- **Form and reference on every payment.** Cash: who receives it. Cheque/DD: number and bank. NEFT/RTGS/IMPS/UPI/Card: the reference. No form or no reference: not saved.
- **Limits by form,** as settings: cash ₹10,000, UPI ₹1,00,000, card ₹2,00,000.
- **Never above the advance or the bill, never twice.** One bill can be set off across several advances, but never for more than its total.
- **To recover** = the money still out, once the settle-by date has passed or all bills are in. It blocks the payee's next advance, at any college.
- **No advance to a blacklisted or suspended vendor.** The mark comes from MRF (X13). It is matched by MRF's vendor code, the GST number or the name, and can be limited to some colleges. A suspension ends on its date.
- **The books keep themselves.** Paying writes the On Account voucher; money returned writes a receipt; closing marks the voucher Cleared. A paid advance's voucher cannot be deleted, and its amount, date, payment and status cannot be edited from the voucher form.
- **Every step is on the track,** with who and when.

## 4. Example

MRF case **MRF-0152**: network switches from Sai Electronics, advance before
delivery.

1. Finance clears it with an On Account route: ₹50,000 by NEFT, settle by 15-Dec. MRF sends `advance.requested`, and Accounts plans **SMGG-ADV-2026-00001**.
2. Anitha prepares the payment: NEFT, UTR SBIN426012345.
3. Ms. Rekha approves it. Voucher SMGG-OA-2026-00004 is written, and MRF reads `advance.paid`. The case cannot close: ₹50,000 is with the vendor.
4. The bill INV-778 for ₹5,84,100 comes. Anitha sets the advance against it, and the advance is settled. MRF reads `advance.closed`, and the case's advances no longer block closure.

Kiran takes ₹9,000 in cash for cables (case MRF-0153) and brings a bill for
₹7,500. Anitha marks *All bills in*, so ₹1,500 is to recover, and a new advance
for Kiran is refused. He returns ₹1,500 (receipt RCPT-0091): the advance is
settled and the cash book shows the receipt.

## 5. The link: the API for MRF

All calls are server to server, under `/api/mrf/v1`. Each carries the header
`x-module-credential: <MRF_LINK_SECRET>`, a shared secret of at least 24
characters, set on both sides. If the secret is not set, the link is off and the
calls return 404.

### 5.1 MRF → Accounts: `POST /api/mrf/v1/events`

```json
{ "eventId": "a unique id from MRF", "type": "advance.requested", "data": { … } }
```

- `eventId` makes delivery safe to repeat. The same id gets the first answer back, with `"duplicate": true`.
- An event that failed (4xx) can be sent again with the same id once its cause is fixed.

| `type` | When (map) | `data` |
|---|---|---|
| `advance.requested` | Clearance fixes an On Account route (X2) | `college` (smgg, smwec, smhyd) or `campusId` (a campus with one college), `case`, `po?`, `clearanceRef?`, `payee: {kind: vendor\|employee, name, vendorCode?, gst?, phone? (employee: required), employeeRef?}`, `amount`, `plannedForm?`, `settleBy?` (YYYY-MM-DD; required for a vendor), `recoveredBy?`, `purpose?` |
| `order.issued` | A PO is raised for the case (X3) | `case`, `po`, `vendorCode?` or `payeeName?`. Links the PO to the case's advances that have none |
| `order.cancelled` | A PO is cancelled (X3; F7 "Cancel") | `po`, `reason?`. A plan not yet paid is cancelled. A paid advance becomes **to recover** |
| `vendor.marked` | Blacklisted, suspended or lifted (X13) | `vendor: {code?, name, gst?}`, `mark: blacklisted\|suspended\|lifted`, `reason?`, `details?`, `scopeColleges?` or `scopeCampusIds?`, `from?`, `until?` (suspension), `proposedBy?`, `approvedBy?` |

The reply is `201 {"ok": true, "eventId", "result": {…}}`. For example,
`advance.requested` answers `{"advanceNo": "SMGG-ADV-2026-00001", "state": "planned"}`.

### 5.2 Accounts → MRF: `GET /api/mrf/v1/events?after=<id>&limit=<≤500>`

This is the transactional outbox, written in the same transaction as the
change. Poll it with the last `next`; when `hasMore` is true, ask again at once.

```json
{ "events": [ { "id": 12, "type": "advance.paid", "advanceNo": "SMGG-ADV-2026-00001", "case": "MRF-0152",
                "createdAt": "…", "data": { "reason": "advance paid (X4)", "advance": { …the advance… } } } ],
  "next": 12, "hasMore": false }
```

| `type` | Means |
|---|---|
| `advance.planned` | Planned in Accounts, so MRF can show the plan on the case |
| `advance.paid` | **X4**: payee and amount, form and reference, date paid, the date to settle by |
| `advance.changed` | The figures changed: a bill set off, money returned, all bills in, or the settle-by date passed (sent once) |
| `advance.closed` | Settled in full |
| `advance.cancelled` | A plan cancelled, with the reason |

**The advance**, in every event and in the read API:

```json
{ "advanceNo": "SMGG-ADV-2026-00001", "college": "smgg", "case": "MRF-0152", "po": "PO-0052", "clearance": "CLR-0152",
  "payee": { "kind": "vendor", "name": "Sai Electronics", "vendorCode": "V-SAI" },
  "amount": 50000, "plannedForm": "NEFT", "recoveredBy": "Kiran",
  "state": "with_payee",
  "given": 50000, "settled": 0, "toRecover": 0, "dueDate": "2026-12-15",
  "outstanding": 50000, "setOff": 0, "returned": 0, "overdue": false, "billsFinal": false,
  "payment": { "form": "NEFT", "reference": "SBIN426012345", "datePaid": "2026-11-25", "approvedBy": "rekha" },
  "blocksClosure": true }
```

`state` is one of: `planned`, `prepared` (waiting for approval), `with_payee`,
`to_recover`, `closed`, `cancelled`. These are the **four figures**:

- `given`: what was paid;
- `settled`: set against bills plus returned;
- `toRecover`: what is owed back now;
- `dueDate`: the settle-by date.

### 5.3 MRF reads: the figures and closure

- `GET /api/mrf/v1/advances?case=MRF-0152` (or `?po=` or `?vendor=<vendorCode>`) returns `{"advances": [ …the advance… ]}`.
- `GET /api/mrf/v1/cases/MRF-0152/financial-status` returns `{"case", "advances", "open": [{advanceNo, state, outstanding, toRecover, dueDate, why}], "advancesClosed": true|false}`. This is the advance part of **X12**: a case's money side cannot close while an advance on it is unpaid, still out or to recover.

## 6. Settings (`server/.env`)

| Setting | Default | |
|---|---|---|
| `MRF_LINK_SECRET` | *(empty = off)* | Shared with MRF; ≥ 24 characters (`openssl rand -base64 32`) |
| `ADVANCE_APPROVAL` | `second_person` | `off`: prepared = paid, with no second person |
| `ADVANCE_EMPLOYEE_DAYS` | `15` | An employee's default settle-by period |
| `ADVANCE_CASH_LIMIT` / `ADVANCE_UPI_LIMIT` / `ADVANCE_CARD_LIMIT` | `10000` / `100000` / `200000` | Limits for one advance by form |
| `ADVANCE_HIGH_LIMIT` | `200000` | Above this, a main administrator or a Head approves |

**Permissions,** in *Users & Permissions → On Account*:

- `manage_advances`: plan, prepare, settle. Users who could create vouchers get it automatically.
- `approve_advances`: the second approver. Only main administrators have it until an admin grants it.

## 7. Not built yet, or for others to build

- **Bills come from F3.** Today the Finance Officer types the bill number, date and total when setting off. Once Finance's bill decision (X8) exists, Accounts can take approved bills from it and offer them for set-off.
- **Bank account verification (X11)** and **step-up** are the platform's and Finance's. Until then, high-value approvals need a main administrator or a Head.
- **Numbers (N1).** Advance numbers are `SMGG-ADV-<year>-<n>` until the UOS numbering service is live.
- **Clocks (C1).** The waiting time for "prepared → approved" is on the track, but not yet reported to the platform's clocks.
- **WhatsApp payment messages** to vendors need the paid messaging service (open on the maps).
- **Push.** MRF polls the outbox today. A push (webhook) to MRF can be added once MRF has an endpoint.

## 8. For Devendra: what MRF needs to do

1. Store `MRF_LINK_SECRET`, and call `POST /api/mrf/v1/events`:
   - `advance.requested` when clearance chooses the On Account route;
   - `order.issued` and `order.cancelled` for POs;
   - `vendor.marked` for the blacklist.
2. Poll `GET /api/mrf/v1/events` every 20 s (as for `/sync`). Show `advance.paid` as "Advance with vendor" on the case and the vendor account, and update the figures on `advance.changed` and `advance.closed`.
3. Before closing a case, read `financial-status`. If `advancesClosed` is false, the case shows what is still open.

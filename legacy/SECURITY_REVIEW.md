# Security & Code Review — Handoff

Date: 2026-11-04 · Reviewed at commit `92c9e8f` (line numbers below refer to that commit) · Follows `SECURITY_AUDIT.md` (2026-11-01).

> **Read this first.** This file lists issues that are **not fixed yet**. The GitHub repo
> (`Ram-9177/stmarys-accounts`) is **public**. Do not push this file to the public repo while items
> are open: either make the repo private first or keep this file local. (The site itself does not serve
> it: `functions/_middleware.js` returns 404 for every `.md` file.)

## How to use this document (for the next engineer / Claude session)

1. Work top to bottom. Each item has a **Fix** and a **Done when**. An item is finished only when its test exists and passes.
2. Run the tests with **Node 24 or newer** (needs built-in `node:sqlite`): `node --test tests/*.cjs`.
   On Node 20, `tests/api-smoke.cjs` fails with `ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite`. That is the environment, not a code bug, but it means the API security tests are not running.
3. Add new API tests to `tests/api-smoke.cjs` using the existing `call(handler, action, body, expectedStatus)` helper.
4. Update the **Status** column in the tracker below, and commit after each item.
5. Read "Do not rename" at the bottom before touching any names.

## System summary

- Cloudflare Pages static app plus Pages Functions on D1 (binding `DB`).
- `functions/api/public/voucher/x.js` handles auth, vouchers, account heads, blocks, vendors, users and audit. `functions/api/public/colleges/x.js` handles colleges.
- `functions/_middleware.js` adds security headers and returns 404 for repo files, because `pages_build_output_dir = "."` makes the whole repo deployable.
- Frontend: `app.js` loads `app.old.js`, then `live-adapter.js`, `live-save-override.js`, `admin1-users.js` and `vendor.js`, **in order**. Later files override globals defined in earlier ones.
- Super admins are identified by hard-coded usernames: `admin`, `admin_stmw`, `admin_smhyd`, `baji`. The UI shows the three campus admins as `admin1`, and they log in as `superadmin` plus a college.
- Campuses: `smgg` (Guntur), `smwec` (Budampadu), `smhyd` (Hyderabad).

## Tracker

| # | Severity | Item | Status |
|---|----------|------|--------|
| 1 | High (functional) | Regular Hyderabad users get 403 on their own campus | Open |
| 2 | High (functional) | Vendor IDs collide across colleges, so creating a vendor fails | Open |
| 3 | Important | Bulk vendor import reports success when rows failed | Open |
| 4 | Important | `superadmin` lockout: 10 bad logins lock all three main admins | Open |
| 5 | Important | Rate limits can be bypassed with parallel requests (check-then-increment) | Open |
| 6 | Important | Missing tests for audit fixes A4, A5, A6 | Open |
| 7 | Suggestion | `rate_limits` / `audit_logs` grow without bound from failed logins | Open |
| 8 | Suggestion | Permission defaults and `isSuperAdmin` duplicated and already drifted | Open |
| 9 | Suggestion | Duplicate voucher permission check in `handle()` uses client-sent type | Open |
| 10 | Suggestion | Report-only CSP has no report endpoint | Open |
| 11 | Suggestion | Move browser files to `public/` instead of relying on a deny-list middleware | Open |
| 12 | Low | Smaller correctness items (voucher college move, voucher-number year, audit log scope, vendor `createdAt`, bootstrap password length, blocked-user 403) | Open |
| 13 | Cleanup | Dead code (ask the owner before deleting) | Open |
| — | Owner decision | Open items carried over from `SECURITY_AUDIT.md` section C | Open |

---

## 1. Regular Hyderabad users are locked out of their own campus (High, functional)

**Where:** `functions/api/public/voucher/x.js:255` (`parseCollegeAccess`), `:295` (`publicUser`), `:301` (`allowedCollege`).

**Problem:** `if (user.role === 'user') return ['smgg', 'smwec'];` ignores the user's `college` and `college_access`. A regular user with `college = 'smhyd'` fails `allowedCollege()` on every call: sync, vouchers, heads, blocks and vendors all return `403 College is outside your access`. Meanwhile `publicUser` tells the browser that regular users have `smgg,smwec,smhyd`, so the UI and the server disagree. Colleges created later through `manage_colleges` are unreachable for regular users in the same way. This is the same line as open item D1 in `SECURITY_AUDIT.md`: regular users can also read both Guntur campuses.

**Fix:** Delete the `role === 'user'` shortcut so regular users use `college_access`, falling back to `college`. Make `publicUser.collegeAccess` return the same list the server enforces: `parseCollegeAccess(u).join(',')`, or all colleges for super admins.
**Watch out:** existing regular users at `smgg` currently also see `smwec`. After the fix they only see what `college_access` says. Tell the owner, who may need to grant access explicitly.

**Done when:** a test creates a `role:'user'` account at `smhyd`, logs in, and gets 200 from `syncData {college:'smhyd'}`; the same user gets 403 for a college not in its access; `validateSession().user.collegeAccess` matches.

## 2. Vendor IDs collide across colleges (High, functional)

**Where:** `vendor.js:172` (`getNextVendorId`), `functions/api/public/voucher/x.js:442` (vendors table), `:858` (existence lookup), `:866` (INSERT).

**Problem:** IDs are numbered `V00001…` separately for each college, because `VENDORS` only holds the current college. But `vendors.id` is a `PRIMARY KEY` across all colleges, and the existence lookup is scoped to one college. So the second college to reach a given number runs an INSERT that fails with `UNIQUE constraint failed: vendors.id` (reproduced in SQLite). The user only sees "Server error. Please try again."

**Fix options (owner to choose):**
- (a) **Prefix new IDs with the college**, e.g. `SMWEC-V00001`. Small change; existing rows stay valid. Update `getNextVendorId` to parse the number after the prefix.
- (b) **Composite key `(college, vendor_id)`**. Cleaner, but D1/SQLite cannot change a primary key in place: create a new table, copy the rows, swap the tables. Every `WHERE id=? OR vendor_id=?` must also add `college=?`; `deleteVendor` and `saveVendor` already do.
- Either way, return a clear 409 "Vendor ID already exists" instead of a 500.

**Done when:** a test saves vendor `V00001` in `smgg` and then in `smwec`; both succeed (option b) or the second gets a prefixed ID (option a); listing each college returns only its own vendor.

## 3. Bulk vendor import reports success when rows failed (Important)

**Where:** `functions/api/public/voucher/x.js:898-910`; called fire-and-forget from `vendor.js:143`.

**Problem:** every per-vendor error is caught and logged, and the response is always `{ok:true, count: vendors.length}`. Item 2 is exactly the kind of error this hides. Vendors stored only in the browser can fail to upload without anyone knowing. Each vendor also runs about 3 queries in sequence, so up to 500 vendors means about 1,500 D1 queries in one request. Check this against the **current** D1 per-request query limit on the Cloudflare D1 "Limits" docs page; do not rely on memory.

**Fix:** return `{ ok, saved: n, failed: [{ vendorId, error }] }` with the user-safe message for errors we threw on purpose, and a generic message for the rest. Write in chunks with `DB.batch()`. Lower `MAX_BULK_VENDORS` so one request stays within the query limit. In `vendor.js:143`, show a toast when `failed.length > 0`.

**Done when:** a test sends 2 valid vendors and 1 invalid one (a disallowed file type) and gets `saved: 2` and one `failed` entry.

## 4. Ten bad logins lock out all three main admins (Important, security/availability)

**Where:** `functions/api/public/voucher/x.js:518-521`, `:533-534`.

**Problem:** the throttle key is `'login-user:' + requested`. The three campus super admins all log in as `superadmin`, so they share `login-user:superadmin`. Anyone on the internet can send 10 wrong passwords and lock all three out for 15 minutes, and keep doing it. Per-user throttling also lets anyone lock out any staff member by name, and `listAdmins` (`:502`, no login needed) reveals names such as `baji`.

**Fix:** build the user key from the **resolved** account (`admin`, `admin_stmw` or `admin_smhyd`, i.e. the candidate looked up), not the typed name. Prefer keying on the `(ip, account)` pair for the strict 10-attempt limit. Keep a much looser per-account limit across all IPs, e.g. 100 per 15 minutes, as a brute-force backstop. Keep the 200-per-IP limit; campuses share one public IP.

**Done when:** a test makes 10 failed `superadmin` logins for `smgg` and then logs in successfully as `superadmin` for `smwec`; and 10 failures from IP A do not block a correct login from IP B. The test can set the `cf-connecting-ip` header.

## 5. Rate limits can be bypassed with parallel requests (Important, security)

**Where:** `functions/api/public/voucher/x.js:519-534` (login), `:931-960` (`readHits`, `recordHit`, `rateLimit`).

**Problem:** the limiter reads the count, does the work (PBKDF2 with 100k iterations for login), and only then increments. N requests sent at once all read the same count, so "10 per 15 min" really means "10 per burst". This affects login, bootstrap, password change and reset, user creation and bulk import.

**Fix:** increment first, atomically, and use the returned value:
```sql
INSERT INTO rate_limits(key,count,window_start) VALUES(?,1,?)
ON CONFLICT(key) DO UPDATE SET
  count        = CASE WHEN ?-window_start>=? THEN 1 ELSE count+1 END,
  window_start = CASE WHEN ?-window_start>=? THEN ? ELSE window_start END
RETURNING count
```
Reject if `count > limit`. For login, increment before checking the password and clear or decrement on success. That keeps the "only failures count" behaviour without the race. This also saves one query per request.

**Done when:** a test fires 15 concurrent wrong-password logins with `Promise.all` and at least 5 of them get 429.

## 6. Missing tests for audit fixes A4, A5, A6 (Important)

**Where:** `tests/api-smoke.cjs`. Fixes are described in `SECURITY_AUDIT.md` section A.

**Problem:** the most serious fixes have no regression test, so nothing stops them from silently breaking again.

**Add tests:**
- **A4 (pass-the-hash):** seed a user with `password_salt='legacy-sha256'` and a SHA-256 `password_hash`. Logging in with only `passwordHash` returns 401. Logging in with the plaintext returns 200, and afterwards the row's `password_salt` is no longer `legacy-sha256`.
- **A5 (cross-college):** a user limited to `smgg` gets 403 from `listHeads`, `listBlocks` and `listVendors` with `college:'smwec'`. A user without `view_vendor_ledger`, `manage_vendors` or an admin role gets 403 from `listVendors` and `vendors: []` from `syncData`.
- **A6 (voucher type lock):** a user without `edit_voucher` edits an existing on-account voucher with `type:'debit'` and gets 403; amount `0` or negative gets 400; date `2026-02-31` gets 400.
- **CI:** add `"engines": {"node": ">=24"}` (there is no `package.json` yet; create a minimal one) and a CI job that runs `node --test tests/*.cjs`.

## 7. `rate_limits` and `audit_logs` grow without bound (Suggestion)

**Where:** `functions/api/public/voucher/x.js:533-535`.

Every failed login with a new username inserts a `rate_limits` row and an `audit_logs` row, with up to 250 characters of attacker-controlled text. Nothing deletes them. **Fix:** on logout, which already cleans up expired sessions, or on a small sample of logins, run `DELETE FROM rate_limits WHERE window_start < ?`, using now minus the largest window (3600 s). Cut `requested` to 64 characters before writing it to `audit_logs`.

## 8. Permission defaults and `isSuperAdmin` are duplicated and have drifted (Suggestion)

**Where:** default permission lists in `voucher/x.js:248`, `voucher/x.js:682` and `colleges/x.js:37`; `isSuperAdmin` in both API files.

`:248` includes `view_vendor_ledger,manage_vendors` for admins, but `:682` (`createUser`) and the colleges copy do not, so an admin with an empty `permissions` column gets different rights depending on which code reads it. The colleges copy of `isSuperAdmin` was missing `admin_smhyd` until commit `54601d6`. **Fix:** create `functions/_lib/auth.js` exporting `isSuperAdmin`, `parsePerms`, `parseCollegeAccess`, `DEFAULT_ADMIN_PERMS`, `DEFAULT_USER_PERMS` and `throwError`, and import it from both APIs. Pages Functions bundle imports from folders whose names start with `_` without turning them into routes.

## 9. Duplicate voucher permission check uses the client-sent type (Suggestion)

**Where:** `functions/api/public/voucher/x.js:102-116` vs `:630-635`.

`handle()` decides using `body.voucher.type`, which the client controls. `saveVoucher` checks again using the type stored in the database. Only the second check is correct; the first gives a false sense of safety. **Fix:** remove the update branch of the check in `handle()` and keep the create check (`create_voucher`) plus the database-based checks in `saveVoucher`.

## 10. Report-only CSP has no report endpoint (Suggestion)

**Where:** `functions/_middleware.js:16-28`.

The plan in `SECURITY_AUDIT.md` is to read the browser console and then enforce, but violations on staff browsers are never seen. **Fix:** add a `report-uri /api/csp-report` directive and a tiny Function that logs the request body with `console.log`, view it with `wrangler pages deployment tail`. After about a week with no violations, move `script-src`/`connect-src` into the enforced header.

## 11. Move browser files to `public/` (Suggestion)

**Where:** `wrangler.toml` (`pages_build_output_dir = "."`), `functions/_middleware.js`.

The middleware is a deny-list, so any new file type not on it is public. **Fix:** move `index.html`, `style.css`, `*.js` (frontend only), `assets/` and the user-manual PDF into `public/`, set `pages_build_output_dir = "public"`, and shrink the middleware to security headers only. Check the `app.js` loader paths and the `?v=` cache-busting still work.

## 12. Smaller correctness items (Low)

- **Voucher moves college on edit:** the UPDATE at `voucher/x.js:636` sets `college=row.college`, so an edit can move a voucher to another college the user can access, while `voucher_no` keeps the old prefix. Either forbid changing the college on update or regenerate `voucher_no`.
- **Voucher-number year:** `voucherNumber` (`:646`) uses the server's current year, not the voucher date or the Indian financial year (April–March). Ask the owner which one they want.
- **Audit log spans colleges:** `listAudit` (`:920`) returns every college's rows, including IPs, to anyone with `view_audit`. Scope it to the caller's colleges, or keep it super-admin only.
- **Vendor `createdAt` comes from the client:** `saveVendor` (`:855`) accepts it, and it decides which payments count in the vendor ledger (commit `97dcf04`). Keep the existing value on update and use `now()` on insert.
- **Env bootstrap password:** `createInitialAdmin` (`:477`) accepts 6 characters and skips `assertPassword`. Call `assertPassword` on the env password too.
- **Blocked-user response:** a blocked user with the correct password gets 403 "blocked" (`:538`), which tells an attacker the password is right. Low impact; optionally return the generic 401.

## 13. Dead code (ask the owner before deleting)

- `adminOnly`, `need` and `needAny` in `voucher/x.js` (`:234`, `:272`, `:275`) are never called.
- The `passwordHash` branch in `createInitialAdmin` (`:482-485`) is unreachable; both callers pass `''`.
- `live-adapter.js:135, 204, 230` still send `passwordHash`, which the server ignores. Remove it, so a reusable legacy hash is no longer sent over the network.
- `doLogin` and `doResetPassword` in `app.old.js` (`:241`, `:313`) are replaced at load time by `live-adapter.js` and `admin1-users.js`.

## Carried over from `SECURITY_AUDIT.md` section C (owner decisions)

- **D1:** regular users can read both Guntur campuses. This is resolved by item 1.
- **D2:** `view_vendor_ledger` is a default permission and also unlocks "show all vouchers" (`listVouchers`/`syncData` `showAll`). Decide whether the ledger needs all vouchers or only vendor-linked ones.
- **D3:** any user in a college can edit other users' on-account vouchers. Confirm this is intended.
- **Password change** does not require the current password.
- **Session token** is kept in `localStorage` and sent in the request body. Move to the HttpOnly cookie only.
- **Session tokens** are stored in plaintext in D1. Store `SHA-256(token)` instead; this logs everyone out once.
- **Super admins** are identified by username. Replace with a role flag in the database.
- **CSP** is still report-only (see item 10).

## What was verified as OK (no action needed)

- Every D1 query uses bound parameters; there is no SQL built from strings.
- Frontend escaping: a search of `app.old.js`, `vendor.js` and `admin1-users.js` found no server value put into HTML without escaping. The remaining raw interpolations are plain-text clipboard strings (`app.old.js:3420-3437`) and `v.type`, which the server limits to a fixed list. Values inside `onclick` use `esc(JSON.stringify(v))`.
- Privilege escalation: `assertAssignableAccess` and `assertNotMorePrivileged` correctly stop admins granting or taking over permissions they don't have. `createUser` with `role:'head'` passes the route check but is still blocked inside `assertAssignableAccess`.
- Unknown and wrong-password logins do the same hashing work and return the same message.

## Do not rename (product-name references)

The product was renamed from "St. Mary's Voucher System" to **stmarys-accounts** (GitHub repo and folder). Old-name references are listed below. **Only the user-visible text is safe to change.** The others are tied to live infrastructure or stored data.

| Reference | Where | Safe to change? |
|-----------|-------|-----------------|
| `name = "st-marys-voucher-system"` | `wrangler.toml:1` | **No**, not without a migration plan. It is the Cloudflare Pages project name; changing it deploys to a *new* project with a new URL, and secrets (`ADMIN1_INITIAL_PASSWORD`) and the D1 binding would need setting again. |
| `database_name = "st-marys-vouchers"` | `wrangler.toml:7`, `SECURITY_AUDIT.md` backup commands, `VENDOR_SYSTEM_COMPLETE_DOCUMENTATION.md:18` | **No.** It must match the existing D1 database, which cannot be renamed; `database_id` is the real link. |
| `--project-name st-marys-voucher-system` | `VENDOR_SYSTEM_COMPLETE_DOCUMENTATION.md:459` | Only together with the Pages project name. |
| `SMV_SESSION` cookie | `voucher/x.js:415-416`, `colleges/x.js` | **No.** Renaming logs everyone out; it is internal only. |
| `smv_*` localStorage keys (`smv_token`, `smv_paper`, `smv_print`, `smv_qz`, `smv_kiosk`, …) | `app.old.js`, `admin1-users.js`, `index.html` | **No.** Renaming loses saved printer/paper settings and sessions on every device. |
| `<title>St Mary’s Voucher System</title>` and "…sign in to its voucher system" | `index.html:6`, `index.html:20` | Yes, user-visible text. |
| Printer test page text | `app.old.js:3084` | Yes. |
| Module header comment | `vendor.js:2` | Yes. |
| `# St. Mary’s Voucher System`, tree root `StMarysGuntur/` | `README.md:1`, `README.md:12` | Yes. The README tree is also out of date: it misses `functions/`, `tests/`, `vendor.js` and the other modules, and names `logo_smg.png`, while the file is `logo_smgg.png`. |
| Document titles | `SECURITY_AUDIT.md:1`, `VENDOR_SYSTEM_COMPLETE_DOCUMENTATION.md:1,8,256` | Yes. |
| `St_Marys_Voucher_System_User_Manual.pdf` | repo root (not referenced by any code) | Renaming the file is safe; the PDF's content would need regenerating to update the text inside it. |

Note: "voucher" as a business term (the `vouchers` table, `saveVoucher`, `voucher-api-…` version strings) is the domain object, not the product name. Leave it alone.

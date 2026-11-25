# St. Mary's Accounts as a UOS module

Branch `UOS-on_account`. It is built on the v2 TypeScript app (`aws-typescript-rewrite`).
`main` (the live Cloudflare app) is not changed.

This document covers how Accounts connects to the UOS platform, what the platform
team needs to set up, the settings, and what is still open. It follows the UOS
architecture as built on 11 Nov 2026 (`uos-auth-server`, `uos-auth-ui`,
`uos-auth-package`, `uos-module-template`).

---

## 1. What changes for staff

- Staff open **Accounts from the UOS launcher**, with their university sign-in.
  They no longer need a separate Accounts password.
- A person whose email matches an existing Accounts user opens as that user. They
  keep the same permissions, colleges and voucher history.
- A person with no Accounts user is added as **waiting for approval**. An
  Accounts administrator approves them in *Users & Permissions*: the new
  "Approve" button, with a "waiting for approval" badge in the list.
- Accounts opens for **one campus at a time**, the campus picked in UOS. The AP
  campus opens the Guntur and Budampadu books. The HYD campus opens Hyderabad.
  Picking a college on another campus re-opens Accounts through UOS for that
  campus.
- The screens use the UOS module layout: a light header with the UOS launcher
  button, "Accounts" and the open college, a sidebar with icons, and a user menu
  with *Back to UOS* and *Sign out of Accounts*.
- **Printed vouchers, cash books and agreements look exactly as before.**
- Password sign-in can stay on during the move (`UOS_LEGACY_LOGIN=true`). Then
  switch it off.

## 2. How it works

```
UOS shell (uos-auth-ui)                 Accounts (this app, own subdomain)
───────────────────────                 ──────────────────────────────────
launcher → Accounts
POST /auth/select-module {moduleId, campusId}
  → module pass (RS256, ~15 min, aud = accounts module id)
redirect → https://accounts.<domain>/?token=<pass>
                                        web: takes the pass out of the address bar
                                        POST /api/uos/handoff {pass}
                                          verify signature (auth server PUBLIC key), audience, expiry
                                          check UOS sign-out / deactivation in the platform Redis
                                          campus → colleges (UOS_CAMPUS_MAP)
                                          find the Accounts user (by UOS id, else by email; else pending)
                                          pass kept in an httpOnly cookie (path /api)
                                        every API request: same checks, limited to the campus's colleges
~13 min later (pass about to expire)
/reselect?moduleId&campusId&returnTo  ← web sends the browser back (silent re-entry)
→ new pass → returnTo                 → handoff again, same page
```

- **The pass is never stored by page scripts.** After the handoff it lives in an
  httpOnly cookie. API clients may send it as `Authorization: Bearer <pass>`
  instead, the usual way UOS modules are called.
- **Sign-out and deactivation** take effect at once. Every request checks
  `<orgId>:revoked_users` and `<orgId>:signed_out_at:<userId>` in the platform
  Redis. A pass issued at or before the sign-out time is refused. If Redis cannot
  be read, the request is refused (503), not let through.
- **Campus scope is enforced on the server** in `allowedCollege`, which every
  voucher, head, block and vendor route uses. Main administrators are limited to
  the pass's campus too.
- **No refresh tokens for UOS sessions.** When the pass ends:
  - If nothing is being edited, Accounts re-enters through `/reselect`, which
    reloads the page.
  - If a voucher or vendor form has unsaved changes, or a dialog is open, a banner
    offers **Renew session** instead. It opens the shell in a new tab. Once that
    tab is back, this tab carries on, form intact, because the new pass cookie is
    shared.
  - Automatic re-entry happens at most once a minute per tab, so a misbehaving
    redirect cannot loop.
- Business permissions stay in Accounts (*Users & Permissions*), as the UOS rule
  "approvals live in module roles, never in `org_role`" requires. The UOS
  `org_role` is not used to grant anything.

Code: `server/src/uos/*`, `server/src/routes/uos.ts`,
`server/src/middleware/auth.ts`, `web/src/uos/*`, `web/src/auth/AuthProvider.tsx`,
`web/src/layout/AppShell.tsx`. Tests: `server/test/uos.test.ts` and
`web/src/uos/uos.test.tsx`.

## 3. What the platform team (Nihal) needs to do

These use the platform's own scripts. Accounts never changes platform repos.

1. **Register the module**, once per platform:
   ```bash
   register-module --name=accounts --db-prefix=accounts --display="Accounts" --campuses=AP,HYD
   ```
   Then set `modules.base_url = https://accounts.<domain>/` and
   `modules.api_base_url = https://accounts.<domain>/api`.
2. **Tell us**:
   - the module **id** (the pass audience): `UOS_MODULE_ID`;
   - the auth server **public key**: `UOS_AUTH_PUBLIC_KEY`. Never the private key;
   - SMRU's **org id**: `UOS_ORG_ID`;
   - the **campus ids** of AP and HYD: `UOS_CAMPUS_MAP`;
   - the **shell URL**: `UOS_SHELL_URL`;
   - the **platform Redis URL and db number**, where sign-outs are written:
     `UOS_REDIS_URL`.
3. **Entitle** SMRU and the AP and HYD campuses to Accounts. Give accounts staff
   the module grant in the shell (Admin → Modules).
4. *(Only if Accounts' data moves into the tenant DB)* run
   `provision-tenant ... --modules=...,accounts`. That creates the `accounts`
   schema and the `accounts_admin` / `accounts_app` roles. See §6.
5. `credential:issue --module=accounts` is **not needed yet**. It is for the
   sync listener (phase 2, §8).

## 4. Settings

All are in `server/.env.example`. In `.env`, keep single quotes around the JSON
value.

| Setting | Example | Notes |
|---|---|---|
| `UOS_ENABLED` | `true` | Turns UOS sign-in on |
| `UOS_MODULE_ID` | `accounts` or the module's id | Must equal the pass `aud` |
| `UOS_AUTH_PUBLIC_KEY` / `UOS_AUTH_PUBLIC_KEY_PATH` | PEM or base64 PEM | Several PEM blocks are allowed while keys rotate |
| `UOS_ISSUER` | *(optional)* | Checks `iss` if set |
| `UOS_SHELL_URL` | `https://uos.smru.in` | May include a path (staging serves the shell at `/auth`) |
| `UOS_SHELL_LOGOUT_PATH` | *(optional)* | Where *Sign out of Accounts* lands; default is the shell home |
| `UOS_CAMPUS_MAP` | `'{"<AP id>": ["smgg","smwec"], "<HYD id>": ["smhyd"]}'` | Campus → colleges; a college belongs to one campus |
| `UOS_ORG_ID` | SMRU's org id | Passes for other universities are refused |
| `UOS_REDIS_URL` | `redis://…/0` | Platform Redis for sign-out checks; required in production |
| `UOS_REVOCATION_CHECK` | `true` | Leave on |
| `UOS_NEW_USERS` | `pending` | `pending` (admin approves), `active`, or `off` (email must already exist) |
| `UOS_DEFAULT_PERMISSIONS` | `create_voucher,view_own_vouchers,print_voucher` | For users created that way; admins adjust when approving |
| `UOS_LEGACY_LOGIN` | `true` during the move, then `false` | `false` switches off password sign-in, first-run setup and Microsoft sign-in, and ends old password sessions |
| `UOS_LINK_EMAILS` | `admin:principal@smru.in,baji:baji@smru.in` | Gives existing users their UOS email at start-up; only fills empty emails |
| `REDIS_KEY_PREFIX` | `accounts:` | When sharing a Redis with other UOS services |
| `DATABASE_SCHEMA`, `MIGRATION_DATABASE_URL`, `DB_APP_ROLE` | `accounts`, admin URL, `accounts_app` | For the tenant-DB layout (§6) |

## 5. Rollout

1. Deploy this branch to **its own subdomain**, e.g. `accounts.<domain>`. API and
   UI are served together, the API under `/api`. UOS rule: don't host modules as
   paths under the shell's host, and don't add the module to the auth server's
   `CORS_ORIGINS`. Neither is needed here.
2. Import the live data from Cloudflare D1:
   ```bash
   npm run import:d1 -w server -- <export>.sql
   ```
   Do this as the cut-over step, when `main` stops taking new vouchers.
3. Start with `UOS_LEGACY_LOGIN=true`. Set staff emails in *Users & Permissions*,
   or put the main administrators in `UOS_LINK_EMAILS`.
4. Staff open Accounts from the UOS launcher. Each is linked on first entry.
   Watch for *waiting for approval* users and approve or adjust them.
5. When everyone is in through UOS, set `UOS_LEGACY_LOGIN=false`.

Keep security headers on: the app already sends CSP, `frame-ancestors 'self'`,
`nosniff` and the rest through helmet. If nginx sits in front, it must not strip
them.

## 6. Database layout

There are two options, and both work without code changes:

- **Own database** (as now): leave `DATABASE_SCHEMA` empty.
- **UOS tenant DB** (`smru_tenant`, schema `accounts`):
  - set `DATABASE_SCHEMA=accounts`;
  - set `DATABASE_URL` to the `accounts_app` role and `MIGRATION_DATABASE_URL` to
    `accounts_admin`;
  - set `DB_APP_ROLE=accounts_app`.

  Migrations run as admin, and their history goes to `accounts.knex_migrations`.
  Afterwards the app role is granted rights on every table and sequence.

UOS forces row-level security on module tables keyed on `app.campus_scope`. That
is not added yet (§8); campus scope is enforced in the API for now.

## 7. Open questions to confirm against the platform code

I couldn't open the SuperCXO repos from this session. These details follow the
architecture document, and the code accepts the common variants until they are
confirmed:

1. **Handoff parameter**: where the shell puts the pass when it redirects. We
   accept `token`, `pass`, `access_token`, `module_pass` and `module_token`, in
   the query string or the fragment (`web/src/uos/handoff.ts`).
2. **Pass claim names**: person id (`sub`), email, name, org (`org_id` or
   `orgId`), campus (`campus_id`, `campusId` or a `campus` object). See
   `normalizeClaims` in `server/src/uos/pass.ts`.
3. **Revocation keys**: whether `revoked_users` is a set (we also handle a hash,
   sorted set, list or JSON), and whether `signed_out_at` is seconds or
   milliseconds (both handled).
4. **`/reselect` parameters**: `moduleId`, `campusId`, `returnTo` (a path),
   exactly as in the architecture document.
5. **Issuer** (`iss`) value, if passes carry one.
6. **The shell's theme tokens** (`uos-auth-ui` `src/index.css` `@theme` and
   `public/theme-init.js`), to match colours exactly. All colours come from
   `web/src/index.css`, so this is a one-file change.

## 8. Not done yet (phase 2)

- **Use `@uos/auth` itself** (pinned `#v1.12.1`): `requireAuth`, `scopedRequest`,
  `createSyncListener` and `createAccess`. The package is private; once this repo
  can install it, `server/src/uos/*` can be swapped for it.
- **Shared access engine (`/uos/*` routes)**, so Accounts roles are managed from
  the shell's Admin → Modules screens instead of Accounts' own *Users &
  Permissions*.
- **Sync listener and shadow tables** (`/sync/events` every 20 s with
  `x-module-credential`). Not needed for sign-in: deactivation is already
  enforced through the Redis check, and names and emails refresh at each entry.
- **Row-level security** in the tenant schema.
- **Dark theme**, and the exact UOS shell palette (§7.6).

## 9. Trying it locally

```bash
npm run dev:uos -w server -- keys     # prints UOS_AUTH_PUBLIC_KEY + UOS_DEV_PRIVATE_KEY: add both to server/.env
```

Add to `server/.env`:

```
UOS_ENABLED=true
UOS_MODULE_ID=accounts
UOS_SHELL_URL=http://localhost:5173/fake-shell
UOS_CAMPUS_MAP='{"campus-ap": {"code": "AP", "colleges": ["smgg","smwec"]}, "campus-hyd": {"code": "HYD", "colleges": ["smhyd"]}}'
UOS_LINK_EMAILS=admin:principal@smru.in
```

Then start the app and sign a pass, as the shell would:

```bash
npm run dev:api & npm run dev:web
npm run dev:uos -w server -- pass --email principal@smru.in --campus campus-ap
```

The last command prints a URL. Opening it is the same as clicking Accounts in the
UOS launcher. Try an unknown email to see the approval flow, or
`--minutes 1.6` with a half-filled voucher to see the renewal banner.

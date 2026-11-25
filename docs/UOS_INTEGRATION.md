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
- The screens look like the UOS shell. Its colours, fonts, corners and shadows
  are copied value for value from the shell's live stylesheet (§10). The layout
  matches too: a 244px nav on the left with the brand, the accent band across
  the top, a light or dark theme, and a user menu with *Back to UOS* and
  *Sign out of Accounts*.
- **On Account** is now the F2/B4 flow of the UOS maps. It is joined to MRF:
  see [ON_ACCOUNT_MRF.md](ON_ACCOUNT_MRF.md).
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
redirect → <base_url>/sso-callback#token=<pass>[&returnTo=<path>]
                                        web: takes the pass (and returnTo) out of the address bar
                                        POST /api/uos/handoff {pass}
                                          verify signature (auth server PUBLIC key), audience, expiry
                                          check UOS sign-out / deactivation in the platform Redis
                                          campus → colleges (UOS_CAMPUS_MAP)
                                          find the Accounts user (by UOS id, else by email; else pending)
                                          pass kept in an httpOnly cookie (path /api)
                                        every API request: same checks, limited to the campus's colleges
                                        then goes to returnTo (a path) or the home page
~13 min later (pass about to expire)
/reselect?moduleId&campusId&returnTo  ← web sends the browser back (silent re-entry)
→ <base_url>/sso-callback#token=…&returnTo=…  → handoff again, same page
```

The handoff format, the `/reselect` parameters and the shell's `returnTo` rule
were read from the shell's own code, as served on staging on 25 Nov:

- the shell sends `token` and `returnTo` in the fragment of `/sso-callback`;
- `returnTo` must start with `/`, must not start with `//`, and must contain no
  backslash and no control character;
- `/reselect` stops after 3 tries in a minute.

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
| `UOS_SHELL_URL` | `https://stage-stmarys-uos.supercxo.ai` | The shell's address (on staging it is served at the root; `/auth/` redirects there) |
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
| `UOS_ACCENT_COLOR` | `#095078` | The university's accent in UOS (its `accent_color`), applied the way the shell applies it. Empty = the UOS default |
| `MRF_LINK_SECRET`, `ADVANCE_*` | | On Account and the MRF link: see [ON_ACCOUNT_MRF.md](ON_ACCOUNT_MRF.md) §6 |

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

I couldn't open the SuperCXO repos from this session. What the shell's served
code shows is now settled:

- the handoff;
- `/reselect`;
- the theme tokens.

The rest follows the architecture document, and the code accepts the common
variants until they are confirmed:

1. ~~Handoff parameter~~ **Settled**: `/sso-callback#token=<pass>&returnTo=<path>`.
2. **Pass claim names**: person id (`sub`), email, name, org (`org_id` or
   `orgId`), campus (`campus_id`, `campusId` or a `campus` object). See
   `normalizeClaims` in `server/src/uos/pass.ts`.
3. **Revocation keys**: whether `revoked_users` is a set (we also handle a hash,
   sorted set, list or JSON), and whether `signed_out_at` is seconds or
   milliseconds (both handled).
4. ~~`/reselect` parameters~~ **Settled**: `moduleId`, `campusId`, `returnTo`.
5. **Issuer** (`iss`) value, if passes carry one.
6. ~~The shell's theme tokens~~ **Settled**: copied from the shell's stylesheet
   (§10). One open point: the module cannot see the university's own accent
   colour (`org.accent_color`), so set `UOS_ACCENT_COLOR` to the same value.

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

The last command prints `http://localhost:5173/sso-callback#token=…`, the same
address the shell opens; add `--return-to /advances` to land on a page. Opening
it is the same as clicking Accounts in the UOS launcher. Try an unknown email to
see the approval flow, or `--minutes 1.6` with a half-filled voucher to see the
renewal banner.

## 10. The look: the UOS shell's tokens

Every colour in Accounts comes from `web/src/index.css`, which carries the
shell's tokens value for value:

| Token | Value |
|---|---|
| Page | `--bg` #edf1f6 and `--bg-2` #e5ebf3 |
| Surfaces | `--surface-1/2/3` #fff, #f4f7fb, #e8eef6 |
| Borders | #dce3ec, #d3dce7, #c3cfde |
| Ink | #0f172a down to #8794a5 |
| Accent | `--accent` #095078, `--accent-block` #0c4a6e (the header band) |
| Status | success, warning and danger, each with its tint |
| Shadows | `--elev-1/2/3` |
| Corners | 10, 14, 18 and 24 px |
| Controls | 48 px |
| Fonts | Plus Jakarta Sans (text) and IBM Plex Mono (figures), self-hosted as in the shell |

- **Dark theme.** It works as in the shell. The choice (Light, Dark or System,
  in the user menu) is kept under `uos-theme`, and `public/theme-init.js`
  applies it before the first paint.
- **Printed documents keep their own styles,** so they do not change.

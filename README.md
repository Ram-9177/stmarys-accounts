# St. Mary's Voucher System — v2

Voucher, cash book and vendor-ledger system for St. Mary's Group of Institutions (Guntur, Budampadu, Hyderabad).

v2 replaces the Cloudflare Pages + D1 version (kept for reference in [`legacy/`](legacy/)) with a TypeScript stack that runs on AWS.

| Layer | Stack |
|---|---|
| API (`server/`) | Node.js + TypeScript, Express 4, PostgreSQL 16 via Knex, Redis 7, Zod validation, JWT (RS256) + bcrypt, Microsoft SSO (OpenID Connect), Nodemailer, Vitest + Supertest |
| Web (`web/`) | React 19 + TypeScript, Vite, Tailwind CSS 4, TanStack Query, React Router 7, in-house component kit, Vitest + Testing Library |
| Deploy (`infra/`) | Docker image (API serves the built web app), Caddy HTTPS, nightly `pg_dump` to S3. See [infra/AWS-DEPLOY.md](infra/AWS-DEPLOY.md) |

## Local development

Requirements: Node 20+, PostgreSQL 16 and Redis 7 (Homebrew services, or `docker compose up -d`).

```bash
npm install
createdb stmarys_dev && createdb stmarys_test
cp server/.env.example server/.env          # defaults work for local Postgres/Redis
npm run dev:api                              # http://localhost:4000 (applies migrations on start)
npm run dev:web                              # http://localhost:5173 (proxies /api to :4000)
```

- **Empty database:** the sign-in page offers *first-time setup* to create the main administrators.
- **Copy of real data:** import a Cloudflare D1 export, then set a local-only password for exploring (this only works on `*_dev` / `*_test` databases):
  ```bash
  npm run import:d1 -w server -- ~/Desktop/stmarys-backup/d1/<export>.sql
  # put DEV_SEED_PASSWORD=... in server/.env, then:
  npm run dev:password -w server -- admin baji
  ```

## Tests

```bash
npm test               # server (needs the stmarys_test DB + Redis) and web
npm run typecheck
```

## Sign-in and roles (same rules as v1)

- **Main administrators** sign in as `superadmin` and pick their campus: `admin` (Guntur), `admin_stmw` (Budampadu), `admin_smhyd` (Hyderabad). `baji` is also a main administrator. Main administrators have every permission on every campus.
- **Other users** have a role (user / admin / head), a home college, extra college access, and individual permissions such as `create_voucher`, `edit_voucher` and `cash_book`. Admins can grant only permissions and colleges they hold themselves.
- **Visibility:** regular users see their own vouchers plus all on-account vouchers. Admins see all vouchers.
- **Passwords** are hashed with bcrypt. Accounts migrated from v1 keep their old passwords, and each is upgraded to bcrypt on that user's first login.
- **Sessions** use a 15-minute RS256 access token and a 14-day rotating refresh token kept in Redis, both in httpOnly cookies. Resetting a password or blocking a user signs them out everywhere immediately.

## What changed from v1

**Same as v1:** permissions, campus access, voucher numbers, voucher rules, the print layout and the legacy reports. All existing data and passwords carry over.

**Added**
- Cash book opening and closing balances, plus Last Month and This FY quick ranges.
- Voucher number on the printed voucher.
- Vendor Excel import with per-row errors.
- Aadhaar masked in lists, and bank details hidden from users without `manage_vendors`.
- Optional Microsoft sign-in and email notifications.
- Live sync every 30 seconds that sends data only when something changed.

**Fixed**
- The cash book Excel "Total" row (always 0 in v1).
- Two admins creating the same new vendor ID can no longer overwrite each other (the second gets a 409 error).

**Removed**
- QZ Tray and Electron silent printing. Use browser printing, Chrome `--kiosk-printing`, or the USB thermal printer.
- The login-screen "reset another user's password" panel. Use *Users & Permissions* instead.
- Excel cell colours in exports. Widths, merged headers and number formats are kept.

**Unchanged on purpose, for your review:** as in v1, anyone holding `view_vendor_ledger` sees **every** voucher in their college, not only their own. That permission is in the default set for regular users. The rule is in `canViewAllVouchers` in `server/src/lib/permissions.ts`.

## Project layout

```
server/src/routes/       auth, vouchers, lookups (heads/blocks), vendors, users, admin (colleges/audit)
server/src/lib/          permissions (ported 1:1 from v1), passwords, tokens, rate limits, audit, mailer, SSO
server/src/db/migrations PostgreSQL schema
server/scripts/          import-d1.ts (Cloudflare -> Postgres), generate-keys.ts, dev-set-password.ts
web/src/features/        vouchers, reports (dashboard/analytics/cash book/Excel), vendors, admin
infra/                   production compose, Caddy, backups, AWS guide
legacy/                  v1 source (Cloudflare Pages Functions + vanilla JS) - reference only
```

# Deploying to AWS

Every push to `main` (and, until the cut-over, to `aws-typescript-rewrite`) runs the **Test and deploy** GitHub Actions workflow:

```
push → tests (Postgres + Redis) → build Docker image → push to Amazon ECR → AWS Systems Manager runs
infra/aws/deploy-on-server.sh on the EC2 server → app restarts → workflow checks /api/health
```

- **No AWS keys are stored in GitHub.** The workflow signs in to a role that only it can use (GitHub OIDC), and that role may only push this app's image and run the deploy on this one server.
- **No SSH.** Port 22 is closed. Admin access goes through *Systems Manager → Session Manager* in the AWS Console.

| | |
|---|---|
| Region | ap-south-1 (Mumbai) |
| Server | 1 × EC2 t3.small, Ubuntu 24.04, 30 GB encrypted disk, Elastic IP |
| On the server (Docker) | Caddy (automatic HTTPS), app, PostgreSQL 16, Redis 7, nightly backup |
| Backups | `pg_dump` every night at 02:30 IST to a private, versioned S3 bucket (Glacier after 30 days, deleted after 1 year) |
| Cost | about **US$20–25/month**: t3.small ~$16, disk ~$3, public IP ~$4, plus a few cents for S3/ECR |

## 1. One-time setup (about 10 minutes)

On your Mac:

```bash
brew install awscli
aws configure sso          # or: aws configure   (use an admin user in your AWS account)
cd "/Volumes/Ram - MAC/Backup_Vocher/stmarys-accounts"
bash infra/aws/setup.sh                                   # free address: https://<ip>.sslip.io
# or, with your own domain:
DOMAIN=vouchers.stmarys.edu.in bash infra/aws/setup.sh
```

`setup.sh` creates everything from [`aws/stack.yml`](aws/stack.yml) and saves the outputs as GitHub repository variables (`AWS_REGION`, `AWS_DEPLOY_ROLE_ARN`, `ECR_REPOSITORY_URI`, `EC2_INSTANCE_ID`, `SITE_URL`). You can re-run it safely; it updates the stack in place.

On first boot the server generates its own database password and login-signing keys into `/opt/stmarys/infra/.env`. They never leave the server.

**Domain**
- **No domain:** the site is at `https://<elastic-ip-with-dashes>.sslip.io`, for example `https://13-234-5-6.sslip.io`. It's free and has a real HTTPS certificate, with no DNS setup.
- **Your own domain:** add an **A record** pointing your domain at the Elastic IP that `setup.sh` prints. HTTPS starts by itself once the record resolves. To switch later, re-run `setup.sh` with `DOMAIN=...`, edit `DOMAIN=` in the server's `.env` (Session Manager), and redeploy.

Start the first deploy:
```bash
gh workflow run deploy.yml --repo Ram-9177/stmarys-accounts --ref aws-typescript-rewrite
gh run watch --repo Ram-9177/stmarys-accounts
```

## 2. Move the data from Cloudflare D1

1. Announce a short freeze, then take a final export:
   ```bash
   npx wrangler d1 export st-marys-vouchers --remote --output=final.sql
   ```
2. In the AWS Console, open **Systems Manager → Session Manager → Start session** on `stmarys-vouchers-server`, then:
   ```bash
   sudo -iu ubuntu && cd /opt/stmarys/infra
   # copy final.sql here, e.g. via S3:  aws s3 cp s3://<backup-bucket>/import/final.sql backups/
   docker compose -f docker-compose.prod.yml --env-file .env cp backups/final.sql app:/tmp/final.sql
   docker compose -f docker-compose.prod.yml --env-file .env exec app node dist/scripts/import-d1.js /tmp/final.sql --dry-run
   docker compose -f docker-compose.prod.yml --env-file .env exec app node dist/scripts/import-d1.js /tmp/final.sql
   ```
   The import is all-or-nothing. Add `--wipe` to replace an earlier import.
3. Sign in on each campus and compare voucher counts and totals with the old site.

Users keep their passwords; each is upgraded to bcrypt on that user's first login. Everyone signs in once after the move. Main administrators still sign in as **superadmin** plus their campus.

## 3. Cut-over: switch production to AWS

1. Merge `aws-typescript-rewrite` into `main`. The workflow deploys `main` to AWS.
2. **Disconnect Cloudflare Pages** from the GitHub repo (Cloudflare dashboard → Workers & Pages → vocher-software → Settings → Builds → disconnect), or delete the project once you're confident. Do this before or right after the merge, or Cloudflare will try to build the new code.
3. Remove `aws-typescript-rewrite` from the `on.push.branches` list in `.github/workflows/deploy.yml` and from `DeployBranches` in `stack.yml`.

## Day-2 operations

| Task | How |
|---|---|
| Deploy an update | push to `main`, or Actions → *Test and deploy* → *Run workflow* |
| Roll back | Actions → pick an older successful run → *Re-run jobs* (redeploys that commit's image) |
| Logs | Session Manager: `cd /opt/stmarys/infra && docker compose -f docker-compose.prod.yml logs -f app` |
| Backup now | `... exec backup backup.sh` |
| Restore | `... exec -T postgres pg_restore --clean --if-exists -U stmarys -d stmarys < backups/<file>.dump` |
| Extra safety | EC2 → Lifecycle Manager → daily EBS snapshots, keep 7 |

## Optional features

- **Microsoft sign-in:** in Entra ID → App registrations, set the redirect URI to `https://<domain>/api/auth/sso/microsoft/callback`. Put `MS_CLIENT_ID` and `MS_CLIENT_SECRET` in the server's `.env` and redeploy.
- **Email notifications** via Amazon SES SMTP: set `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` and `MAIL_FROM` in the server's `.env` and redeploy.

## Later: managed services

- Move PostgreSQL to RDS by setting `DATABASE_URL` and `DATABASE_SSL=true`.
- Move Redis to ElastiCache by setting `REDIS_URL`.
- Run the same image on ECS Fargate behind a load balancer for zero-downtime deploys.

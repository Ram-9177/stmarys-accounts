# Deploying to AWS

This setup runs everything on **one EC2 instance with Docker Compose**: HTTPS (Caddy), the app, PostgreSQL 16 and Redis 7, plus nightly backups to S3. It costs roughly **US$15–20/month** and suits the current load (a few thousand vouchers a year, three campuses). The [upgrade path](#upgrade-path-managed-services) at the end covers moving to managed RDS and ElastiCache later.

Region: **ap-south-1 (Mumbai)**, the closest region to the campuses.

---

## 1. One-time AWS setup (AWS Console)

1. **S3 bucket for backups:** S3 → Create bucket, for example `stmarys-voucher-backups`. Keep *Block all public access* on and turn on *Bucket Versioning*. Optionally add a lifecycle rule that moves objects to Glacier after 30 days and deletes them after 365.
2. **IAM role for the server:** IAM → Roles → Create role → *AWS service: EC2*. Add an inline policy:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [{ "Effect": "Allow", "Action": ["s3:PutObject"], "Resource": "arn:aws:s3:::stmarys-voucher-backups/*" }]
   }
   ```
   Name it `stmarys-voucher-ec2`.
3. **EC2 instance:** EC2 → Launch instance.
   - AMI: **Ubuntu 24.04 LTS**, type **t3.small** (2 GB RAM)
   - Storage: **30 GB gp3**, encrypted
   - IAM instance profile: `stmarys-voucher-ec2`
   - Security group: inbound **80** and **443** from anywhere, plus **22** from *your IP only*
   - Key pair: create one and keep the `.pem` file safe
4. **Elastic IP:** EC2 → Elastic IPs → Allocate, then associate it with the instance.
5. **DNS:** at your domain provider, add an `A` record such as `vouchers.stmarys.edu.in` pointing to the Elastic IP.

## 2. Install the app on the server

```bash
ssh -i stmarys.pem ubuntu@<ELASTIC_IP>
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu && exit   # log back in afterwards
sudo mkdir -p /opt/stmarys && sudo chown ubuntu /opt/stmarys
git clone -b aws-typescript-rewrite https://github.com/Ram-9177/stmarys-accounts.git /opt/stmarys
cd /opt/stmarys/infra && cp .env.example .env && nano .env
```

Fill in `.env`:
- `DOMAIN`: the DNS name from step 1.5
- `POSTGRES_PASSWORD`: run `openssl rand -base64 32`
- `JWT_PRIVATE_KEY` and `JWT_PUBLIC_KEY`: on your laptop, run `npm run keys -w server` and paste both lines
- `BACKUP_S3_URI`: for example `s3://stmarys-voucher-backups/postgres`

Start the stack:
```bash
docker compose -f docker-compose.prod.yml --env-file .env up -d --build
docker compose -f docker-compose.prod.yml logs -f app   # wait for "listening on :4000"
curl https://$DOMAIN/api/health                        # {"ok":true,"db":true,"redis":true}
```

## 3. Move the data from Cloudflare D1

Use the newest D1 export. The 19 Nov 2026 backup is in `~/Desktop/stmarys-backup/d1/`. To take a fresh one just before the cut-over:
```bash
npx wrangler d1 export st-marys-vouchers --remote --output=final.sql
```

Copy it to the server and import it. The import runs in a single transaction, so it either completes fully or changes nothing.
```bash
# on your laptop
scp -i stmarys.pem final.sql ubuntu@<ELASTIC_IP>:/opt/stmarys/infra/backups/
# on the server
docker compose -f docker-compose.prod.yml cp backups/final.sql app:/tmp/final.sql
docker compose -f docker-compose.prod.yml exec app node dist/scripts/import-d1.js /tmp/final.sql --dry-run   # rehearse
docker compose -f docker-compose.prod.yml exec app node dist/scripts/import-d1.js /tmp/final.sql             # real import
```
Add `--wipe` to replace data from an earlier import.

What carries over:
- **Kept:** vouchers (same ids and voucher numbers), users and their passwords, permissions, college access, account heads, blocks, vendors with their attachments, and the full audit log.
- **Passwords:** users sign in with their existing passwords. Each old password hash is upgraded to bcrypt automatically on that user's first login.
- **Not kept:** sessions. Everyone signs in once after the move. Main administrators still sign in as **superadmin** plus their campus.

## 4. Cut-over checklist

1. Announce a short freeze, then take a **final** D1 export (step 3) so no vouchers are lost.
2. Import it, then sign in on each campus and compare the voucher counts and totals with the old site.
3. Leave the Cloudflare site running, read-only, for a week as a fallback. **Do not merge this branch into `main` before the cut-over**, because Cloudflare Pages auto-deploys `main`.
4. Afterwards, remove the D1 binding or delete the Pages project.

## 5. Day-2 operations

| Task | Command (in `/opt/stmarys/infra`) |
|---|---|
| Deploy an update | `git pull && docker compose -f docker-compose.prod.yml up -d --build` |
| Logs | `docker compose -f docker-compose.prod.yml logs -f app` |
| Manual backup now | `docker compose -f docker-compose.prod.yml exec backup backup.sh` |
| Restore a backup | `docker compose -f docker-compose.prod.yml exec -T postgres pg_restore --clean --if-exists -U stmarys -d stmarys < backups/<file>.dump` |
| psql shell | `docker compose -f docker-compose.prod.yml exec postgres psql -U stmarys` |

Also turn on **EBS snapshots** (EC2 → Lifecycle Manager → daily, keep 7) as a second safety net.

## Optional features

- **Microsoft SSO:** in Entra ID → App registrations → New, set the redirect URI to `https://<DOMAIN>/api/auth/sso/microsoft/callback`. Put the client ID and secret in `.env`, add each user's Microsoft email under *Users & Permissions*, then restart the app.
- **Email notifications** (new account, password reset): Amazon SES → verify your domain → *SMTP settings* → create credentials. Fill in `SMTP_HOST=email-smtp.ap-south-1.amazonaws.com`, `SMTP_USER` and `SMTP_PASS`.

## Upgrade path: managed services

When you want AWS to handle database patching, failover and backups:
- **RDS for PostgreSQL 16** (db.t4g.micro or larger): set `DATABASE_URL` to the RDS endpoint and `DATABASE_SSL=true`. Move the data with `pg_dump` / `pg_restore`.
- **ElastiCache for Redis 7**: set `REDIS_URL`.
- Remove the `postgres`, `redis` and `backup` services from the compose file. RDS automated backups replace the backup job.
- For zero-downtime deploys, run the same Docker image on **ECS Fargate** behind an **Application Load Balancer** with an ACM certificate (replacing Caddy).

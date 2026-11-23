#!/bin/bash
# Runs ON the EC2 server (sent by GitHub Actions through AWS Systems Manager).
#   deploy-on-server.sh <git-sha> <ecr-image-uri>
# Updates the infra files to the deployed commit, pulls the new app image and restarts it.
# The app applies database migrations itself on start; Postgres/Redis data is untouched.
set -euo pipefail
SHA="$1"
IMAGE="$2"
cd /opt/stmarys

for i in $(seq 1 60); do [ -f .bootstrap-done ] && break; echo "waiting for first-boot setup..."; sleep 10; done
[ -f .bootstrap-done ] || { echo "first-boot setup never finished"; exit 1; }

git fetch --quiet origin
git checkout --quiet --force "$SHA"

cd infra
REGION=$(grep '^AWS_REGION=' .env | cut -d= -f2)
REGISTRY="${IMAGE%%/*}"
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$REGISTRY" >/dev/null

# Record the image so a manual `docker compose up -d` on the server uses the same version.
if grep -q '^APP_IMAGE=' .env; then sed -i "s#^APP_IMAGE=.*#APP_IMAGE=${IMAGE}#" .env; else echo "APP_IMAGE=${IMAGE}" >> .env; fi

COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env"
$COMPOSE pull app
$COMPOSE up -d --no-build app caddy postgres redis
$COMPOSE up -d --build backup

# Wait for the new app container to report healthy.
for i in $(seq 1 30); do
  status=$(docker inspect --format '{{.State.Health.Status}}' "$($COMPOSE ps -q app)" 2>/dev/null || echo starting)
  [ "$status" = healthy ] && { echo "app healthy at ${SHA:0:7}"; docker image prune -af --filter until=168h >/dev/null || true; exit 0; }
  sleep 5
done
echo "app did not become healthy; recent logs:"
$COMPOSE logs --tail 80 app
exit 1

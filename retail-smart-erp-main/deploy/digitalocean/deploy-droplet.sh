#!/usr/bin/env bash
# skyERPOS — deploy this checkout to the Droplet (layout of docs/DEPLOY_DIGITALOCEAN.md §3):
#   /opt/poslanka/docker-compose.yml  services: db (postgres), app (image poslanka:latest built from
#   retail-smart-erp-main with deploy/digitalocean/Dockerfile.droplet), caddy;  /opt/poslanka/.env
#
#   ./deploy/digitalocean/deploy-droplet.sh            build here, ship, back up, migrate, restart
#   CHECK_ONLY=1 ./deploy/digitalocean/deploy-droplet.sh   only verify SSH + the server layout
#
# Env: DEPLOY_HOST (default root@168.144.216.104), REMOTE_DIR (/opt/poslanka), APP_SERVICE (app),
#      DB_SERVICE (db), IMAGE (poslanka:latest), SKIP_BUILD=1 (reuse the last local build),
#      SKIP_BACKUP=1 (only when the database is not the compose `db` service and is backed up elsewhere),
#      BUILD_ON=laptop (build the Docker image here and upload it, so the 1 GB Droplet never runs
#      npm ci; default BUILD_ON=server, the way the guide has always deployed).
#
# The image is always built explicitly from the copied code (`docker build`, whether or not the
# server's docker-compose.yml has a `build:` section) and stamped with the git commit; after the
# restart the script checks that /api/health reports THAT commit. A deploy that leaves the old code
# running (compose without `build:`, `docker compose up -d` reusing the old image) fails loudly.
#
# Safe order: the running container keeps its own copy of the code, so copying files changes nothing
# until the restart. A database dump is taken before migrations, the previous image is kept as
# <image>:rollback, and if the new container is not healthy within ~3 minutes the previous image is
# started again. Migrations only add (0191 = one nullable column), so the old image runs on them.
set -euo pipefail

HOST="${DEPLOY_HOST:-root@168.144.216.104}"
REMOTE_DIR="${REMOTE_DIR:-/opt/poslanka}"
APP_SERVICE="${APP_SERVICE:-app}"
DB_SERVICE="${DB_SERVICE:-db}"
IMAGE="${IMAGE:-poslanka:latest}"
ROLLBACK="${IMAGE%%:*}:rollback"
APP_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
REMOTE_APP="$REMOTE_DIR/$(basename "$APP_DIR")"
STAMP="$(date +%Y%m%d-%H%M%S)"
COMMIT="$(git -C "$APP_DIR" rev-parse --short=12 HEAD)$(git -C "$APP_DIR" diff --quiet HEAD -- . 2>/dev/null || echo '-dirty')"
step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
# DEPLOY_HOST=local runs the "server" side in REMOTE_DIR on this machine (rehearsal of a deploy)
if [ "$HOST" = local ]; then
  remote() { bash -c "cd '$REMOTE_DIR' && $*"; }
  TARGET="$REMOTE_APP"
else
  remote() { ssh -o BatchMode=yes -o ConnectTimeout=15 "$HOST" "cd '$REMOTE_DIR' && $*"; }
  TARGET="$HOST:$REMOTE_APP"
fi

step "Server check ($HOST:$REMOTE_DIR)"
remote "test -f docker-compose.yml && { test -f .env || test -f .env.production; } && docker compose config --services" > /tmp/skyerpos-services.$$ \
  || { echo "Cannot reach $HOST or $REMOTE_DIR/docker-compose.yml / .env (.env.production) is missing."; exit 1; }
grep -qx "$APP_SERVICE" /tmp/skyerpos-services.$$ || { echo "No '$APP_SERVICE' service in docker-compose.yml"; exit 1; }
HAS_DB=0; grep -qx "$DB_SERVICE" /tmp/skyerpos-services.$$ && HAS_DB=1
rm -f /tmp/skyerpos-services.$$
echo "services ok (database in compose: $([ $HAS_DB = 1 ] && echo yes || echo no))"
# The app service must run the image this script builds, or the restart brings back the old code
APP_IMAGE=$(remote "docker compose config --format json" | python3 -c "import sys,json; print(json.load(sys.stdin)['services']['$APP_SERVICE'].get('image',''))" 2>/dev/null || true)
if [ -n "$APP_IMAGE" ] && [ "$APP_IMAGE" != "$IMAGE" ]; then
  echo "The '$APP_SERVICE' service runs image '$APP_IMAGE' but this script builds '$IMAGE'. Rerun with IMAGE=$APP_IMAGE."; exit 1
fi
LIVE_COMMIT=$(remote "docker compose exec -T $APP_SERVICE curl -fsS http://127.0.0.1:3000/api/health" 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('commit','unknown'))" 2>/dev/null || echo unknown)
echo "running now: commit $LIVE_COMMIT (unknown = deployed before commit stamping); deploying: $COMMIT"
# A $6 Droplet has 25 GB of disk: the new image, the rollback image and a dump must fit
FREE_GB=$(remote "df -BG --output=avail . | tail -1 | tr -dc 0-9")
remote "free -m | sed -n '1,3p'; df -h . | tail -1"
if [ "${FREE_GB:-0}" -lt 3 ]; then
  echo "Only ${FREE_GB} GB free on the server: free some space first (docker image prune, old backups)."; exit 1
fi
[ "${CHECK_ONLY:-}" = 1 ] && { echo "CHECK_ONLY: nothing changed."; exit 0; }
if [ $HAS_DB = 0 ] && [ "${SKIP_BACKUP:-}" != 1 ]; then
  echo "The database is not the compose '$DB_SERVICE' service: back it up yourself, then rerun with SKIP_BACKUP=1."; exit 1
fi

cd "$APP_DIR"
if [ "${SKIP_BUILD:-}" != 1 ]; then
  step "Production build (local)"
  npm run build
fi
[ -f .next/BUILD_ID ] && [ -f server.js ] || { echo "No production build (.next/BUILD_ID, server.js). Run npm run build."; exit 1; }
echo "build $(cat .next/BUILD_ID), git $(git rev-parse --short HEAD)$(git diff --quiet || echo ' + uncommitted changes')"

step "Copy code to $REMOTE_APP (the running app is not affected yet)"
EXCLUDES=(--exclude node_modules --exclude .git --exclude '.env' --exclude '.env.*' --exclude apps/mobile
  --exclude public/uploads --exclude .next/cache --exclude .next/dev --exclude coverage --exclude test-results
  --exclude playwright-report --exclude stress-tests/results --exclude docs/screenshots --exclude '*.log')
mkdir -p "$REMOTE_APP" 2>/dev/null || true
rsync -az "${EXCLUDES[@]}" --exclude .next ./ "$TARGET/"
rsync -az --delete --exclude cache --exclude dev .next/ "$TARGET/.next/"

if [ $HAS_DB = 1 ] && [ "${SKIP_BACKUP:-}" != 1 ]; then
  step "Database backup before migrations"
  remote "mkdir -p backups && docker compose exec -T $DB_SERVICE sh -c 'pg_dump -U \"\$POSTGRES_USER\" -Fc \"\$POSTGRES_DB\"' > backups/pre-deploy-$STAMP.dump \
    && test -s backups/pre-deploy-$STAMP.dump && ls -lh backups/pre-deploy-$STAMP.dump \
    && ls -1t backups/pre-deploy-*.dump | tail -n +11 | xargs -r rm -f"   # keep the last 10
fi

step "New image ($([ "${BUILD_ON:-server}" = laptop ] && echo 'built here, uploaded' || echo 'built on the server with the locked packages'))"
remote "docker image inspect $IMAGE >/dev/null 2>&1 && docker tag $IMAGE $ROLLBACK || true"
if [ "${BUILD_ON:-server}" = laptop ]; then
  docker build --build-arg GIT_COMMIT="$COMMIT" -f deploy/digitalocean/Dockerfile.droplet -t "$IMAGE" .
  if [ "$HOST" = local ]; then :; else docker save "$IMAGE" | gzip -1 | ssh -o BatchMode=yes "$HOST" "gunzip | docker load"; fi
else
  remote "cd '$REMOTE_APP' && docker build --build-arg GIT_COMMIT=$COMMIT -f deploy/digitalocean/Dockerfile.droplet -t $IMAGE ."
fi

step "Migrations (scripts/migrate.mjs: drizzle/meta/_journal.json, no-op when up to date)"
if ! remote "docker compose run --rm --no-deps -e SKIP_MIGRATIONS= $APP_SERVICE npm run db:migrate"; then
  echo "Migration failed: the old app is still running unchanged. Fix, then deploy again."
  remote "docker image inspect $ROLLBACK >/dev/null 2>&1 && docker tag $ROLLBACK $IMAGE || true"
  exit 1
fi

step "Restart and health check"
remote "docker compose up -d --no-deps --force-recreate $APP_SERVICE"
for i in $(seq 1 36); do
  if remote "docker compose exec -T $APP_SERVICE curl -fsS http://127.0.0.1:3000/api/health" > /tmp/skyerpos-health.$$ 2>/dev/null; then
    HEALTH=$(cat /tmp/skyerpos-health.$$); rm -f /tmp/skyerpos-health.$$
    echo "healthy after ~$((i * 5)) s: $HEALTH"
    if ! printf '%s' "$HEALTH" | grep -q "\"commit\":\"$COMMIT\""; then
      echo "The app is healthy but is NOT running commit $COMMIT (old image still in use)."
      break
    fi
    remote "docker image prune -f >/dev/null; docker builder prune -f --filter until=168h >/dev/null" || true
    step "Deployed $COMMIT"; exit 0
  fi
  sleep 5
done
rm -f /tmp/skyerpos-health.$$
step "New version not healthy or not running: rolling back to the previous image"
remote "docker compose logs --tail 60 $APP_SERVICE" || true
remote "docker tag $ROLLBACK $IMAGE && docker compose up -d --no-deps --force-recreate $APP_SERVICE"
echo "Rolled back. The database keeps the new (additive) migrations; the backup is backups/pre-deploy-$STAMP.dump."
exit 1

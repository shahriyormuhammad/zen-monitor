#!/usr/bin/env bash
set -euo pipefail

REMOTE_PATH="${DEPLOY_REMOTE_PATH:-/srv/projects/enterprise-wb-analytics}"
REMOTE_NAME="${DEPLOY_REMOTE_NAME:-origin}"
BRANCH="${DEPLOY_BRANCH:-main}"
HEALTH_URL="${DEPLOY_HEALTH_URL:-http://127.0.0.1:3457/api/health}"
SERVICES="${DEPLOY_SERVICES:-enterprise-wb-analytics.service enterprise-wb-analytics-inngest.service}"
LOCK_FILE="${DEPLOY_LOCK_FILE:-/tmp/enterprise-wb-analytics-deploy.lock}"

if [[ "${DEPLOY_LOCK_HELD:-0}" != "1" ]]; then
  exec 9>"$LOCK_FILE"
  if ! flock -n 9; then
    echo "[deploy] another deploy is running; waiting for lock=$LOCK_FILE"
    flock 9
  fi
  echo "[deploy] lock acquired lock=$LOCK_FILE"
else
  echo "[deploy] lock already held lock=$LOCK_FILE"
fi

cd "$REMOTE_PATH"

echo "[deploy] path=$REMOTE_PATH branch=$BRANCH"
git remote set-url --push "$REMOTE_NAME" DISABLED_PUSH_FROM_PRODUCTION
git fetch "$REMOTE_NAME" "$BRANCH"
git checkout "$BRANCH"
git reset --hard "$REMOTE_NAME/$BRANCH"

npm ci --no-audit --no-fund

if [[ ! -x node_modules/.bin/next || ! -f node_modules/next/link.d.ts ]]; then
  echo "[deploy] incomplete dependency install: Next executable/types are missing" >&2
  ls -ld node_modules node_modules/.bin node_modules/.bin/next node_modules/next node_modules/next/link.d.ts 2>/dev/null || true
  exit 1
fi

npm run build
npm run db:migrate

systemctl daemon-reload
systemctl restart $SERVICES
systemctl is-active $SERVICES

health_ok=false
for attempt in $(seq 1 30); do
  if payload="$(curl -fsS "$HEALTH_URL" 2>/tmp/enterprise-wb-deploy-health.err)"; then
    if HEALTH_PAYLOAD="$payload" node -e '
const raw = process.env.HEALTH_PAYLOAD ?? "";
const body = JSON.parse(raw);
if (body?.ok !== true) {
  throw new Error(`healthcheck failed: ${raw}`);
}
console.log(`[deploy] health ok: ${raw}`);
'; then
      health_ok=true
      break
    fi
  fi

  echo "[deploy] waiting for health attempt=$attempt url=$HEALTH_URL"
  sleep 2
done

if [[ "$health_ok" != true ]]; then
  echo "[deploy] healthcheck did not become ready"
  cat /tmp/enterprise-wb-deploy-health.err 2>/dev/null || true
  exit 1
fi

echo "[deploy] done $(git rev-parse HEAD)"

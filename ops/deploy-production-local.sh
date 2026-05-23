#!/usr/bin/env bash
# Atomic local production deploy for metric-pulse-app-01.
# Run on the server from /srv/projects/enterprise-wb-analytics:
#   npm run deploy:production:local

set -euo pipefail

REPO="${1:-/srv/projects/enterprise-wb-analytics}"
SERVICE="${SERVICE:-enterprise-wb-analytics.service}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3457/api/health}"
ALLOW_DIRTY_DEPLOY="${ALLOW_DIRTY_DEPLOY:-0}"

cd "$REPO"

log() {
  printf '[deploy] %s\n' "$*"
}

fail() {
  printf '[deploy] ERROR: %s\n' "$*" >&2
  exit 1
}

require_file() {
  [[ -f "$1" ]] || fail "missing required file: $1"
}

if [[ "$ALLOW_DIRTY_DEPLOY" != "1" ]]; then
  if ! git diff --quiet || ! git diff --cached --quiet; then
    git status --short >&2
    fail "working tree has uncommitted changes; commit first or set ALLOW_DIRTY_DEPLOY=1 for an emergency deploy"
  fi
fi

sha="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
log "deploying ${sha} from ${REPO}"

log "typecheck"
npm run typecheck

log "stop ${SERVICE} before building to avoid serving half-written .next artifacts"
systemctl stop "$SERVICE" || true

log "build standalone artifact"
npm run build

require_file ".next/standalone/server.js"
require_file ".next/BUILD_ID"
[[ -d ".next/static" ]] || fail "missing .next/static"
[[ -d ".next/server" ]] || fail "missing .next/server"

log "prepare standalone runtime assets"
bash ops/prepare-next-standalone.sh "$REPO"
require_file ".next/standalone/server.js"
[[ -d ".next/standalone/.next/static" ]] || fail "missing standalone static assets"

log "start ${SERVICE}"
systemctl start "$SERVICE"

log "wait for health ${HEALTH_URL}"
for attempt in {1..30}; do
  if payload="$(curl -fsS "$HEALTH_URL" 2>/dev/null)"; then
    if HEALTH_PAYLOAD="$payload" node <<'NODE'
const data = JSON.parse(process.env.HEALTH_PAYLOAD || '{}');
if (data.ok !== true) process.exit(1);
const bad = Object.entries(data.checks || {}).filter(([, value]) => value !== 'ok');
if (bad.length > 0) process.exit(1);
NODE
    then
      log "health ok: ${payload}"
      log "deploy complete (${sha})"
      exit 0
    fi
  fi
  sleep 2
done

systemctl status "$SERVICE" --no-pager -l >&2 || true
journalctl -u "$SERVICE" -n 80 --no-pager >&2 || true
fail "service did not become healthy"

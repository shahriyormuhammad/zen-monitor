#!/usr/bin/env bash
# Prepare Next.js standalone output for production systemd startup.
#
# Next 16 standalone can leave App Router route-group manifests under
# .next/server/app/(group)/... while runtime lookup expects the flat route path.
# Keep this logic outside ExecStartPre inline shell so systemd does not expand
# bash parameter substitutions such as ${file#prefix}.

set -euo pipefail

REPO="${1:-/srv/projects/enterprise-wb-analytics}"
NEXT_DIR="$REPO/.next"
STANDALONE_DIR="$NEXT_DIR/standalone"
STANDALONE_NEXT_DIR="$STANDALONE_DIR/.next"
ROOT_SERVER_APP_DIR="$NEXT_DIR/server/app"
STANDALONE_SERVER_APP_DIR="$STANDALONE_NEXT_DIR/server/app"

if [[ ! -d "$NEXT_DIR" ]]; then
  echo "ERROR: $NEXT_DIR does not exist. Run npm run build first." >&2
  exit 1
fi

if [[ ! -d "$STANDALONE_DIR" ]]; then
  echo "ERROR: $STANDALONE_DIR does not exist. Next standalone output is missing." >&2
  exit 1
fi

mkdir -p "$STANDALONE_NEXT_DIR"

rm -rf "$STANDALONE_NEXT_DIR/static"
cp -R "$NEXT_DIR/static" "$STANDALONE_NEXT_DIR/static"

rm -rf "$STANDALONE_DIR/public"
if [[ -d "$REPO/public" ]]; then
  cp -R "$REPO/public" "$STANDALONE_DIR/public"
fi

sync_route_group_manifests() {
  local server_app_dir="$1"
  local copied=0

  if [[ ! -d "$server_app_dir" ]]; then
    echo "WARN: $server_app_dir does not exist; skipping route-group manifest sync" >&2
    return 0
  fi

  while IFS= read -r -d '' group_dir; do
    while IFS= read -r -d '' manifest_file; do
      relative_path="${manifest_file#"$group_dir"/}"
      destination="$server_app_dir/$relative_path"
      mkdir -p "$(dirname "$destination")"
      cp -f "$manifest_file" "$destination"
      copied=$((copied + 1))
    done < <(
      find "$group_dir" -type f \( -name '*-manifest*' -o -name '*manifest.json' \) -print0
    )
  done < <(
    find "$server_app_dir" -mindepth 1 -maxdepth 1 -type d -name '(*)' -print0
  )

  echo "Synced $copied route-group manifest files into $server_app_dir."
}

sync_route_group_manifests "$ROOT_SERVER_APP_DIR"
sync_route_group_manifests "$STANDALONE_SERVER_APP_DIR"

echo "Prepared Next standalone output."

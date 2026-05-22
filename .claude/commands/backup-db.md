---
name: backup-db
description: Take a fresh pg_dump snapshot of the production database on goalbot
argument-hint: "[reason-tag]"
---

Create an ad-hoc database snapshot on the production server `goalbot`. Use this before any manual SQL, before `ALTER SYSTEM`, before any destructive operation that changes data or schema outside the normal deploy flow.

Read `docs/operations/BACKUP_POLICY.md` for the full policy.

## 1. Take the snapshot

Argument parsing:
- If the user provided a reason/tag in `$ARGUMENTS`, use it in the snapshot directory name (e.g. `/backup-db before-p0-05` → `pre-before-p0-05-20260416-...`).
- If no argument, use `pre-adhoc` as the tag.

```bash
ssh goalbot 'set -e
TAG="${TAG:-adhoc}"
SNAP=/srv/backups/enterprise-wb-analytics/pre-${TAG}-$(date -u +%Y%m%d-%H%M%S)
mkdir -p "$SNAP"
cd /srv/projects/enterprise-wb-analytics
DB_URL=$(awk -F= "/^DATABASE_URL=/{sub(/^DATABASE_URL=/,\"\"); print}" .env.production)
pg_dump --format=custom --compress=9 --file="$SNAP/database.dump" "$DB_URL"
cd "$SNAP"
sha256sum database.dump > checksums.sha256
echo "PATH=$SNAP"
echo "SIZE=$(du -h database.dump | cut -f1)"
echo "SHA256=$(awk "{print \$1}" checksums.sha256)"'
```

## 2. Verify the dump

Quickly verify the dump is restorable (metadata check, not full restore):

```bash
ssh goalbot 'pg_restore --list "<SNAP>/database.dump" | head -20'
```

Expect a list of schema objects. If empty or errors — STOP, the dump is broken.

## 3. (Optional) Mirror to local

Ask the user first: "Сделать локальную копию (рекомендую для важных действий)?"

If yes:

```bash
LOCAL=~/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics-backups/<snap-name>
mkdir -p "$LOCAL"
rsync -avz goalbot:/srv/backups/enterprise-wb-analytics/<snap-name>/ "$LOCAL/"
cd "$LOCAL" && shasum -a 256 -c checksums.sha256
```

## 4. Report

- Snapshot directory path on server
- Dump size and sha256
- Whether local mirror was done and its path
- **One-line reminder of the restore command**:
  ```
  pg_restore --clean --if-exists --exit-on-error -d "$DATABASE_URL" <snap>/database.dump
  ```

## When to stop

- `pg_dump` exits non-zero — investigate, do not proceed with the risky action that motivated the backup
- Disk on `/srv` is >95% full — stop, clean up first (see P2-50)
- The snapshot `database.dump` is suspiciously small (< 1 MB) — stop, something is wrong

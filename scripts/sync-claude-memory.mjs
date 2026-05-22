#!/usr/bin/env node
// Syncs operational docs from docs/operations/*.md into the local Claude Code
// project memory so that every new Claude session in this repo auto-loads them.
//
// Usage:
//   node scripts/sync-claude-memory.mjs                 # copy docs -> memory
//   node scripts/sync-claude-memory.mjs --reverse       # copy memory -> docs
//   node scripts/sync-claude-memory.mjs --check         # exit 1 if they differ
//
// This script exists because Claude Code auto-loads memory from
// ~/.claude/projects/<hash>/memory/, which is a per-developer local directory
// and NOT committed to git. We keep the source of truth in docs/operations/
// and mirror it into memory on demand.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(__dirname, '..');
const docsOps = join(repoRoot, 'docs', 'operations');

// Claude Code derives the project memory dir from the main worktree path.
// For this repo it resolves to the hash below (stable across worktrees).
const memoryDir = join(
  homedir(),
  '.claude',
  'projects',
  '-Users-vitea-b-Desktop----------Gemini-enterprise-wb-analytics',
  'memory',
);

// Map: docs filename -> memory filename
// The memory filenames stay lowercase_snake for historical consistency.
const FILE_MAP = {
  'SERVER_PRODUCTION.md': 'server_production.md',
  'DEPLOY_PROCEDURE.md': 'deploy_procedure.md',
  'BACKUP_POLICY.md': 'backup_policy.md',
};

const args = new Set(process.argv.slice(2));
const REVERSE = args.has('--reverse');
const CHECK = args.has('--check');

function sha(p) {
  if (!existsSync(p)) return null;
  return createHash('sha256').update(readFileSync(p)).digest('hex');
}

function log(level, ...msg) {
  const prefix = level === 'err' ? '❌' : level === 'ok' ? '✅' : 'ℹ️';
  console.log(prefix, ...msg);
}

function ensureDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    log('info', 'created', dir);
  }
}

async function main() {
  if (!existsSync(docsOps)) {
    log('err', 'docs/operations directory missing:', docsOps);
    process.exit(1);
  }

  ensureDir(memoryDir);

  let diffs = 0;
  let copied = 0;

  for (const [docFile, memFile] of Object.entries(FILE_MAP)) {
    const docPath = join(docsOps, docFile);
    const memPath = join(memoryDir, memFile);

    if (!existsSync(docPath)) {
      log('err', 'missing in docs/operations/:', docFile);
      diffs += 1;
      continue;
    }

    const docHash = sha(docPath);
    const memHash = sha(memPath);
    const same = docHash === memHash;

    if (CHECK) {
      if (!same) {
        log('err', 'diff:', docFile, '(docs vs memory)');
        diffs += 1;
      } else {
        log('ok', 'same:', docFile);
      }
      continue;
    }

    if (REVERSE) {
      if (!existsSync(memPath)) {
        log('err', 'cannot reverse-copy, memory file missing:', memFile);
        diffs += 1;
        continue;
      }
      if (!same) {
        writeFileSync(docPath, readFileSync(memPath));
        log('ok', 'memory -> docs:', memFile, '->', docFile);
        copied += 1;
      }
      continue;
    }

    if (!same) {
      writeFileSync(memPath, readFileSync(docPath));
      log('ok', 'docs -> memory:', docFile, '->', memFile);
      copied += 1;
    }
  }

  if (CHECK) {
    if (diffs > 0) {
      log('err', `${diffs} file(s) out of sync. Run 'node scripts/sync-claude-memory.mjs' to fix.`);
      process.exit(1);
    }
    log('ok', 'all operational docs are in sync with Claude memory');
    return;
  }

  if (copied === 0) {
    log('info', 'nothing to copy, already in sync');
  } else {
    log('ok', `synced ${copied} file(s)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

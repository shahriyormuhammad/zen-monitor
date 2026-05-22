#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const rootDir = process.cwd();
const migrationsDir = path.join(rootDir, 'drizzle');
const journalPath = path.join(migrationsDir, 'meta', '_journal.json');

function fail(message) {
  console.error(`[migration:check] ${message}`);
  process.exitCode = 1;
}

function readJournal() {
  try {
    return JSON.parse(fs.readFileSync(journalPath, 'utf8'));
  } catch (error) {
    fail(`cannot read ${path.relative(rootDir, journalPath)}: ${error instanceof Error ? error.message : String(error)}`);
    return { entries: [] };
  }
}

const journal = readJournal();
const entries = Array.isArray(journal.entries) ? journal.entries : [];
const tags = new Set();
const indexes = new Set();

if (entries.length === 0) {
  fail('journal has no entries');
}

for (const entry of entries) {
  if (!Number.isInteger(entry.idx)) {
    fail(`entry ${JSON.stringify(entry)} has invalid idx`);
  } else if (indexes.has(entry.idx)) {
    fail(`duplicate idx ${entry.idx}`);
  } else {
    indexes.add(entry.idx);
  }

  if (typeof entry.tag !== 'string' || entry.tag.trim() === '') {
    fail(`entry ${JSON.stringify(entry)} has invalid tag`);
    continue;
  }

  if (tags.has(entry.tag)) {
    fail(`duplicate tag ${entry.tag}`);
  }
  tags.add(entry.tag);

  const sqlPath = path.join(migrationsDir, `${entry.tag}.sql`);
  if (!fs.existsSync(sqlPath)) {
    fail(`journal entry ${entry.tag} has no SQL file`);
  } else if (fs.statSync(sqlPath).size === 0) {
    fail(`SQL file for ${entry.tag} is empty`);
  }
}

const sqlTags = fs.readdirSync(migrationsDir)
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .map((name) => name.slice(0, -4));

for (const tag of sqlTags) {
  if (!tags.has(tag)) {
    fail(`SQL file ${tag}.sql is not listed in journal`);
  }
}

for (let idx = 0; idx < entries.length; idx += 1) {
  if (!indexes.has(idx)) {
    fail(`journal idx sequence has gap at ${idx}`);
  }
}

if (process.exitCode) {
  process.exit();
}

console.log(`[migration:check] ok: ${entries.length} journal entries, ${sqlTags.length} SQL files`);

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const knowledgeRoot = path.join(root, 'docs', 'knowledge');
const errors = [];

const requiredFiles = [
  'docs/knowledge/INDEX.md',
  'docs/knowledge/raw/README.md',
  'docs/knowledge/wiki/README.md',
  'docs/knowledge/wiki/project-map.md',
  'docs/knowledge/wiki/costing-and-unit-economics.md',
  'docs/knowledge/wiki/finance-formulas.md',
  'docs/knowledge/wiki/wildberries-data-sources.md',
  'docs/knowledge/wiki/agent-api-approvals.md',
  'docs/knowledge/decisions/README.md',
  'docs/knowledge/decisions/0001-karpathy-project-memory.md',
  'docs/knowledge/health/README.md',
];

function rel(filePath) {
  return path.relative(root, filePath);
}

function read(filePath) {
  return readFileSync(filePath, 'utf8');
}

function walk(dir) {
  if (!existsSync(dir)) return [];

  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    if (entry.isFile()) return [fullPath];
    return [];
  });
}

function normalizeWikiTarget(value) {
  return value.trim().toLowerCase();
}

for (const file of requiredFiles) {
  const fullPath = path.join(root, file);
  if (!existsSync(fullPath)) {
    errors.push(`Missing required file: ${file}`);
  }
}

const markdownFiles = walk(knowledgeRoot).filter((file) => file.endsWith('.md'));
const wikiDir = path.join(knowledgeRoot, 'wiki');
const decisionsDir = path.join(knowledgeRoot, 'decisions');
const wikiTargets = new Set();

for (const file of markdownFiles) {
  if (!file.startsWith(wikiDir)) continue;

  const basename = path.basename(file, '.md');
  wikiTargets.add(normalizeWikiTarget(basename));

  const title = read(file).match(/^#\s+(.+)$/m)?.[1];
  if (title) wikiTargets.add(normalizeWikiTarget(title));
}

for (const file of markdownFiles) {
  const content = read(file);

  if (file.startsWith(wikiDir) && path.basename(file) !== 'README.md' && !content.includes('## Источники')) {
    errors.push(`${rel(file)} must contain "## Источники"`);
  }

  if (file.startsWith(decisionsDir) && path.basename(file) !== 'README.md') {
    for (const heading of ['## Статус', '## Контекст', '## Решение', '## Последствия', '## Источники']) {
      if (!content.includes(heading)) {
        errors.push(`${rel(file)} must contain "${heading}"`);
      }
    }
  }

  for (const match of content.matchAll(/\[\[([^\]]+)]]/g)) {
    const target = normalizeWikiTarget(match[1].split('|')[0].split('#')[0]);
    if (target && !wikiTargets.has(target)) {
      errors.push(`${rel(file)} has broken wiki link: [[${match[1]}]]`);
    }
  }
}

if (errors.length > 0) {
  console.error('[knowledge:health] FAILED');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log('[knowledge:health] OK');

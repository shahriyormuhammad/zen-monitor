#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readIntEnv, sleep } from './utils.mjs';

const HELP = `
Server watcher for load tests. Samples production through SSH.

Common env:
  LOAD_SSH_HOST=metric-pulse-app-01
  LOAD_WATCH_DURATION_SECONDS=300
  LOAD_WATCH_INTERVAL_SECONDS=5
  LOAD_WATCH_DB=enterprise_wb_analytics_prod
`;

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(HELP.trim());
  process.exit(0);
}

const sshHost = process.env.LOAD_SSH_HOST?.trim() || 'metric-pulse-app-01';
const dbName = process.env.LOAD_WATCH_DB?.trim() || 'enterprise_wb_analytics_prod';
const durationSeconds = readIntEnv('LOAD_WATCH_DURATION_SECONDS', 300, { min: 1, max: 86_400 });
const intervalSeconds = readIntEnv('LOAD_WATCH_INTERVAL_SECONDS', 5, { min: 1, max: 300 });
const outputRoot = process.env.LOAD_OUTPUT_DIR ?? path.join(process.cwd(), 'output', 'load');
const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const outputPath = path.join(outputRoot, `server-watch-${stamp}.csv`);

function shQuote(value) {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function runSample() {
  const remoteScript = `
set -e
read load1 load5 load15 rest < /proc/loadavg
mem_line=$(free -m | awk '/Mem:/ {print $3","$7}')
cpu_idle=$(top -bn1 | awk -F'id,' '/Cpu\\(s\\)|%Cpu/ { split($1,a,","); print a[length(a)] }' | awk '{print $NF}' | head -1)
if [ -z "$cpu_idle" ]; then cpu_used=""; else cpu_used=$(awk -v idle="$cpu_idle" 'BEGIN { printf "%.1f", 100 - idle }'); fi
health=$(curl -sS -o /dev/null -w "%{http_code},%{time_total}" http://127.0.0.1:3457/api/health || echo "000,0")
db=$(sudo -u postgres psql -d ${shQuote(dbName)} -Atc "select count(*) || ',' || count(*) filter (where state='active') || ',' || count(*) filter (where state='idle') from pg_stat_activity where datname=current_database();" 2>/dev/null || echo "0,0,0")
next_pid=$(systemctl show -p MainPID --value enterprise-wb-analytics.service 2>/dev/null || echo "")
if [ -n "$next_pid" ] && [ "$next_pid" != "0" ]; then
  next_rss=$(ps -o rss= -p "$next_pid" | awk '{print $1+0}')
else
  next_rss="0"
fi
printf "%s,%s,%s,%s,%s,%s,%s,%s\\n" "$load1" "$load5" "$load15" "$cpu_used" "$mem_line" "$health" "$db" "$next_rss"
`;

  const result = spawnSync('ssh', [sshHost, remoteScript], {
    encoding: 'utf8',
    stdio: 'pipe',
  });

  if (result.status !== 0) {
    const message = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(message || `ssh ${sshHost} failed`);
  }

  return result.stdout.trim();
}

async function main() {
  await mkdir(outputRoot, { recursive: true });
  const rows = ['timestamp,load1,load5,load15,cpu_used_pct,mem_used_mb,mem_available_mb,health_status,health_time_seconds,db_connections,db_active,db_idle,next_rss_kb'];
  const deadline = Date.now() + durationSeconds * 1000;

  console.log(`[load:watch] start host=${sshHost} duration=${durationSeconds}s interval=${intervalSeconds}s`);
  while (Date.now() < deadline) {
    const timestamp = new Date().toISOString();
    const sample = runSample();
    const line = `${timestamp},${sample}`;
    rows.push(line);
    console.log(line);
    await sleep(intervalSeconds * 1000);
  }

  await writeFile(outputPath, `${rows.join('\n')}\n`, 'utf8');
  console.log(`[load:watch] wrote ${outputPath}`);
}

await main().catch((error) => {
  console.error(`[load:watch] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

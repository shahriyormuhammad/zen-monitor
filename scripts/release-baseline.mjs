import { spawnSync } from "node:child_process";

const reportOnly = process.argv.includes("--report-only");

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: "pipe",
    ...options,
  });

  const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  return {
    ok: result.status === 0,
    status: result.status ?? 1,
    output,
  };
}

function tailLines(text, count = 20) {
  const lines = text.split("\n").filter(Boolean);
  return lines.slice(-count).join("\n");
}

function printSection(title, body) {
  console.log(`\n## ${title}`);
  if (body) {
    console.log(body);
  }
}

const checks = [];

const gitStatus = runCommand("git", ["status", "--short"]);
const dirtyLines = gitStatus.output
  .split("\n")
  .map((line) => line.trimEnd())
  .filter(Boolean);
const runtimeDirty = dirtyLines.filter((line) =>
  /(src\/|supabase\/|package\.json|package-lock\.json|eslint\.config\.mjs)/.test(line),
);

checks.push({
  name: "worktree",
  ok: dirtyLines.length === 0,
  summary:
    dirtyLines.length === 0
      ? "Working tree is clean."
      : `Working tree is dirty (${dirtyLines.length} entries).`,
  details:
    dirtyLines.length === 0
      ? ""
      : [
          runtimeDirty.length > 0
            ? `Runtime-relevant dirty entries detected (${runtimeDirty.length}).`
            : "No runtime-relevant dirty entries detected.",
          dirtyLines.join("\n"),
        ].join("\n"),
});

const migrations = runCommand("npm", ["run", "db:migration:check"]);
checks.push({
  name: "migrations",
  ok: migrations.ok,
  summary: migrations.ok
    ? "Migration journal and SQL files are internally consistent."
    : "Migration journal integrity check failed.",
  details: migrations.output ? tailLines(migrations.output) : "",
});

const build = runCommand("npm", ["run", "build"]);
checks.push({
  name: "build",
  ok: build.ok,
  summary: build.ok ? "Production build passed." : "Production build failed.",
  details: build.output ? tailLines(build.output) : "",
});

const lint = runCommand("npm", ["run", "lint"]);
checks.push({
  name: "lint",
  ok: lint.ok,
  summary: lint.ok ? "ESLint passed." : "ESLint reported blocking issues.",
  details: lint.output ? tailLines(lint.output, 40) : "",
});

const typecheck = runCommand("npm", ["run", "typecheck"]);
checks.push({
  name: "typecheck",
  ok: typecheck.ok,
  summary: typecheck.ok ? "TypeScript typecheck passed." : "TypeScript typecheck reported errors.",
  details: typecheck.output ? tailLines(typecheck.output, 40) : "",
});

const test = runCommand("npm", ["run", "test"]);
checks.push({
  name: "test",
  ok: test.ok,
  summary: test.ok ? "Unit tests passed." : "Unit tests reported blocking issues.",
  details: test.output ? tailLines(test.output, 60) : "",
});

const audit = runCommand("npm", ["run", "audit:production"]);
checks.push({
  name: "audit",
  ok: audit.ok,
  summary: audit.ok ? "Production dependency audit passed." : "Production dependency audit found high+ vulnerabilities.",
  details: audit.output ? tailLines(audit.output, 40) : "",
});

console.log("# Release Baseline Report");
console.log(`Mode: ${reportOnly ? "report-only" : "strict"}`);

for (const check of checks) {
  printSection(`${check.ok ? "PASS" : "FAIL"} ${check.name}`, check.summary);
  if (check.details) {
    console.log(check.details);
  }
}

const failedChecks = checks.filter((check) => !check.ok);

printSection(
  "Summary",
  failedChecks.length === 0
    ? "All baseline checks passed."
    : `Failed checks: ${failedChecks.map((check) => check.name).join(", ")}`,
);

if (!reportOnly && failedChecks.length > 0) {
  process.exit(1);
}

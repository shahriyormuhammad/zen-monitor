import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { cleanupOutputArtifacts } from "@/lib/output-retention";

const tempDirs: string[] = [];

async function makeTempDir() {
  const dir = await mkdtemp(path.join(tmpdir(), "output-retention-"));
  tempDirs.push(dir);
  return dir;
}

async function touchFile(dir: string, name: string, mtimeMs: number) {
  const filePath = path.join(dir, name);
  await writeFile(filePath, "test", "utf8");
  const time = new Date(mtimeMs);
  await utimes(filePath, time, time);
  return filePath;
}

async function touchDir(dir: string, name: string, mtimeMs: number) {
  const targetDir = path.join(dir, name);
  await mkdir(targetDir, { recursive: true });
  const markerPath = path.join(targetDir, "marker.txt");
  await writeFile(markerPath, "test", "utf8");
  const time = new Date(mtimeMs);
  await utimes(markerPath, time, time);
  await utimes(targetDir, time, time);
  return targetDir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("cleanupOutputArtifacts", () => {
  it("removes oldest files beyond maxEntries", async () => {
    const dir = await makeTempDir();
    const nowMs = Date.now();

    await touchFile(dir, "newest.log", nowMs - 1_000);
    await touchFile(dir, "middle.log", nowMs - 2_000);
    await touchFile(dir, "oldest.log", nowMs - 3_000);

    const result = await cleanupOutputArtifacts({
      dir,
      kind: "file",
      maxEntries: 2,
      nowMs,
    });

    const names = (await readdir(dir)).sort();
    expect(result.removed).toBe(1);
    expect(names).toEqual(["middle.log", "newest.log"]);
  });

  it("removes expired directories by age", async () => {
    const dir = await makeTempDir();
    const nowMs = Date.now();

    await touchDir(dir, "recent", nowMs - 2 * 60 * 60 * 1000);
    await touchDir(dir, "expired", nowMs - 10 * 24 * 60 * 60 * 1000);

    const result = await cleanupOutputArtifacts({
      dir,
      kind: "directory",
      maxAgeMs: 7 * 24 * 60 * 60 * 1000,
      nowMs,
    });

    const names = (await readdir(dir)).sort();
    expect(result.removed).toBe(1);
    expect(names).toEqual(["recent"]);
  });

  it("returns zero result for a missing directory", async () => {
    const dir = path.join(tmpdir(), `missing-output-retention-${Date.now()}`);

    const result = await cleanupOutputArtifacts({
      dir,
      kind: "any",
      maxEntries: 5,
    });

    expect(result).toEqual({
      scanned: 0,
      matched: 0,
      removed: 0,
      failed: 0,
    });
  });
});

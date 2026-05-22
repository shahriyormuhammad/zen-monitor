import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

export type OutputRetentionEntryKind = "file" | "directory" | "any";

export type CleanupOutputArtifactsOptions = {
  dir: string;
  kind?: OutputRetentionEntryKind;
  maxAgeMs?: number | null;
  maxEntries?: number | null;
  matchName?: RegExp;
  nowMs?: number;
};

export type CleanupOutputArtifactsResult = {
  scanned: number;
  matched: number;
  removed: number;
  failed: number;
};

type CandidateEntry = {
  fullPath: string;
  isDirectory: boolean;
  mtimeMs: number;
};

function isPositiveInteger(value: number | null | undefined): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function shouldKeepDirent(dirent: { isFile: () => boolean; isDirectory: () => boolean }, kind: OutputRetentionEntryKind) {
  if (kind === "any") {
    return dirent.isFile() || dirent.isDirectory();
  }
  if (kind === "file") {
    return dirent.isFile();
  }
  return dirent.isDirectory();
}

export async function cleanupOutputArtifacts(
  options: CleanupOutputArtifactsOptions,
): Promise<CleanupOutputArtifactsResult> {
  const kind = options.kind ?? "any";
  const maxAgeMs = isPositiveInteger(options.maxAgeMs) ? options.maxAgeMs : null;
  const maxEntries = isPositiveInteger(options.maxEntries) ? options.maxEntries : null;

  if (!maxAgeMs && !maxEntries) {
    return {
      scanned: 0,
      matched: 0,
      removed: 0,
      failed: 0,
    };
  }

  let dirents;
  try {
    dirents = await readdir(options.dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        scanned: 0,
        matched: 0,
        removed: 0,
        failed: 0,
      };
    }
    throw error;
  }

  const nowMs = options.nowMs ?? Date.now();
  const candidates: CandidateEntry[] = [];

  for (const dirent of dirents) {
    if (!shouldKeepDirent(dirent, kind)) {
      continue;
    }
    if (options.matchName && !options.matchName.test(dirent.name)) {
      continue;
    }

    const fullPath = path.join(options.dir, dirent.name);
    try {
      const info = await stat(fullPath);
      candidates.push({
        fullPath,
        isDirectory: dirent.isDirectory(),
        mtimeMs: info.mtimeMs,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs || left.fullPath.localeCompare(right.fullPath));

  let removed = 0;
  let failed = 0;

  for (const [index, candidate] of candidates.entries()) {
    const isOverCountLimit = maxEntries !== null && index >= maxEntries;
    const isExpired = maxAgeMs !== null && nowMs - candidate.mtimeMs > maxAgeMs;

    if (!isOverCountLimit && !isExpired) {
      continue;
    }

    try {
      await rm(candidate.fullPath, {
        recursive: candidate.isDirectory,
        force: true,
      });
      removed += 1;
    } catch {
      failed += 1;
    }
  }

  return {
    scanned: dirents.length,
    matched: candidates.length,
    removed,
    failed,
  };
}

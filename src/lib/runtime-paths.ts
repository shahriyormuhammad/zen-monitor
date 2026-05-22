import path from "node:path";

const NEXT_STANDALONE_SEGMENT = `${path.sep}.next${path.sep}standalone`;

export function resolveProjectRootDir(cwd = process.cwd()) {
  const absoluteCwd = path.resolve(cwd);
  const standaloneIndex = absoluteCwd.lastIndexOf(NEXT_STANDALONE_SEGMENT);
  if (standaloneIndex < 0) {
    return absoluteCwd;
  }

  const projectRoot = absoluteCwd.slice(0, standaloneIndex);
  return projectRoot || path.parse(absoluteCwd).root;
}

export function resolvePersistentOutputDir(...segments: string[]) {
  return path.resolve(resolveProjectRootDir(), "output", ...segments);
}

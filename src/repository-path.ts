import { isAbsolute } from "node:path";

export const MAX_OPERATION_PATH_LENGTH = 4_096;

/** Shared syntactic boundary for repository reads and content-free diagnostics. */
export function normalizeRepositoryPath(path: string): string | undefined {
  const normalized =
    path
      .trim()
      .replaceAll("\\", "/")
      .replace(/^\.\/+/u, "") || ".";
  if (
    normalized.length > MAX_OPERATION_PATH_LENGTH ||
    normalized.includes("\0") ||
    isAbsolute(normalized) ||
    normalized.split("/").includes("..")
  )
    return undefined;
  return normalized;
}

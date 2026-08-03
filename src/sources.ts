import type { Dirent } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

/** Minimal change fields needed to resolve review scope (matches ChangeContext). */
export interface SourceChangeScope {
  readonly scanMode: "changed" | "all";
  readonly changedFiles: readonly string[];
}

/** Default directories skipped when enumerating an entire target. */
export const DEFAULT_IGNORE_DIRECTORIES: readonly string[] = Object.freeze([
  ".git",
  ".next",
  "build",
  "coverage",
  "dist",
  "generated",
  "node_modules",
  "third_party",
  "vendor",
]);

export type InScopeSourceStatus = "changed" | "repository";

/**
 * One source file in the runner's requested review scope.
 *
 * The CLI owns dirty-worktree / PR / all-files resolution. Adversaries must not
 * re-run git to invent a second change list — use these helpers instead.
 */
export interface InScopeSource {
  /** Repository-relative POSIX path. */
  path: string;
  content: string;
  /**
   * "changed" when the path is in the runner's change list (includes untracked).
   * "repository" when scanning the whole target (scanMode all / no change).
   */
  status: InScopeSourceStatus;
}

export interface ListInScopePathsOptions {
  /** Keep only matching paths (after ignore rules). Defaults to all files. */
  include?: (path: string) => boolean;
  /** Maximum paths to return (default unlimited for list, 750 for load). */
  limit?: number;
  /** Directory names to skip during whole-target walks. */
  ignoreDirectories?: readonly string[];
}

export interface LoadInScopeSourcesOptions extends ListInScopePathsOptions {
  /** Skip files larger than this many bytes (default 750_000). */
  maxBytes?: number;
}

/**
 * Paths in scope for this review.
 *
 * - `scanMode: "changed"` (or change list present with changed mode): use
 *   `change.changedFiles` only — the CLI already included untracked worktree
 *   paths. No git.
 * - `scanMode: "all"` or `change === null`: walk the target filesystem.
 */
export async function listInScopePaths(
  repoPath: string,
  change: SourceChangeScope | null,
  options: ListInScopePathsOptions = {},
): Promise<string[]> {
  const include = options.include ?? (() => true);
  const limit = options.limit !== undefined && options.limit > 0 ? options.limit : undefined;
  const ignore = new Set(options.ignoreDirectories ?? DEFAULT_IGNORE_DIRECTORIES);

  let candidates: string[];
  if (change !== null && change.scanMode === "changed") {
    candidates = change.changedFiles.map(normalizePath);
  } else {
    candidates = await walkRelative(repoPath, ignore);
  }

  const out: string[] = [];
  const seen = new Set<string>();
  for (const path of candidates) {
    if (!path || seen.has(path)) continue;
    if (path.split("/").some((segment) => ignore.has(segment))) continue;
    if (!include(path)) continue;
    seen.add(path);
    out.push(path);
    if (limit !== undefined && out.length >= limit) break;
  }
  return out;
}

/**
 * Read file contents for paths in scope.
 *
 * Deleted / unreadable paths are skipped. Binary / oversized files are skipped.
 */
export async function loadInScopeSources(
  repoPath: string,
  change: SourceChangeScope | null,
  options: LoadInScopeSourcesOptions = {},
): Promise<InScopeSource[]> {
  const maxBytes = options.maxBytes ?? 750_000;
  const paths = await listInScopePaths(repoPath, change, {
    include: options.include,
    limit: options.limit ?? 750,
    ignoreDirectories: options.ignoreDirectories,
  });

  const wholeTarget = change === null || change.scanMode === "all";
  const changedSet = new Set((change?.changedFiles ?? []).map(normalizePath));
  const sources: InScopeSource[] = [];

  for (const path of paths) {
    const content = await safeReadText(join(repoPath, path), maxBytes);
    if (content === undefined) continue;
    sources.push({
      path,
      content,
      status: wholeTarget && !changedSet.has(path) ? "repository" : "changed",
    });
  }
  return sources;
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

async function walkRelative(repoPath: string, ignore: ReadonlySet<string>): Promise<string[]> {
  const out: string[] = [];

  async function visit(relativeDir: string): Promise<void> {
    const abs = relativeDir === "" ? repoPath : join(repoPath, relativeDir);
    let entries: Dirent[];
    try {
      entries = await readdir(abs, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const rel =
        relativeDir === "" ? entry.name : `${relativeDir}/${entry.name}`.replaceAll("\\", "/");
      if (entry.isDirectory()) {
        if (ignore.has(entry.name)) continue;
        await visit(rel);
        continue;
      }
      if (entry.isFile()) {
        out.push(rel.replaceAll("\\", "/"));
      }
    }
  }

  await visit("");
  return out;
}

async function safeReadText(absPath: string, maxBytes: number): Promise<string | undefined> {
  try {
    const buffer = await readFile(absPath);
    if (buffer.byteLength > maxBytes) return undefined;
    if (buffer.includes(0)) return undefined;
    return buffer.toString("utf8");
  } catch {
    return undefined;
  }
}

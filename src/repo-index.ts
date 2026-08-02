import { open, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";

/** Environment variable set by the CLI pointing at an on-disk repo index directory. */
export const ADVERSARY_REPO_INDEX_ENV = "ADVERSARY_REPO_INDEX";

export const REPO_INDEX_SCHEMA_VERSION = "v1";

export interface RepoIndexMeta {
  schemaVersion: string;
  fingerprint: string;
  repoPath: string;
  builtAt?: string;
  fileCount: number;
  edgeCount: number;
}

export interface RepoIndexFile {
  path: string;
  language: string;
  size: number;
  hash: string;
}

export interface RepoIndexEdge {
  from: string;
  to: string;
  kind: string;
}

export interface ListFilesOptions {
  /** Exact language match: go | typescript | javascript */
  language?: string;
  /** Maximum files to return (default 5000). */
  limit?: number;
}

/**
 * Read-only navigation over a CLI-built repository index (files + import edges).
 */
export interface RepoIndex {
  readonly dir: string;
  readonly meta: RepoIndexMeta;
  listFiles(options?: ListFilesOptions): Promise<RepoIndexFile[]>;
  file(path: string): Promise<RepoIndexFile | undefined>;
  importsOf(path: string): Promise<RepoIndexEdge[]>;
  importersOf(path: string): Promise<RepoIndexEdge[]>;
}

export class RepoIndexUnavailableError extends Error {
  readonly code = "repo_index_unavailable";

  constructor(message: string) {
    super(message);
    this.name = "RepoIndexUnavailableError";
  }
}

/** Open an index directory written by the adversary CLI (JSONL schema v1). */
export async function openRepoIndex(dir: string): Promise<RepoIndex> {
  const metaRaw = await readFile(join(dir, "meta.json"), "utf8");
  const meta = JSON.parse(metaRaw) as RepoIndexMeta;
  if (meta.schemaVersion !== REPO_INDEX_SCHEMA_VERSION) {
    throw new RepoIndexUnavailableError(
      `unsupported repo-index schema ${meta.schemaVersion} (want ${REPO_INDEX_SCHEMA_VERSION})`,
    );
  }
  const files = await readJsonl<RepoIndexFile>(join(dir, "files.jsonl"));
  const edges = await readJsonl<RepoIndexEdge>(join(dir, "edges.jsonl"));
  return new MemoryRepoIndex(dir, meta, files, edges);
}

/**
 * Load index from ADVERSARY_REPO_INDEX when set; otherwise return null
 * (callers treat as unavailable, not an error).
 */
export async function repoIndexFromEnvironment(
  env: Record<string, string | undefined> = process.env,
): Promise<RepoIndex | null> {
  const dir = env[ADVERSARY_REPO_INDEX_ENV]?.trim();
  if (!dir) {
    return null;
  }
  try {
    return await openRepoIndex(dir);
  } catch (error) {
    throw new RepoIndexUnavailableError(
      error instanceof Error ? error.message : String(error),
    );
  }
}

class MemoryRepoIndex implements RepoIndex {
  constructor(
    readonly dir: string,
    readonly meta: RepoIndexMeta,
    private readonly files: RepoIndexFile[],
    private readonly edges: RepoIndexEdge[],
  ) {}

  async listFiles(options: ListFilesOptions = {}): Promise<RepoIndexFile[]> {
    const limit = options.limit && options.limit > 0 ? options.limit : 5000;
    const language = options.language?.trim();
    const out: RepoIndexFile[] = [];
    for (const file of this.files) {
      if (language && file.language !== language) {
        continue;
      }
      out.push(file);
      if (out.length >= limit) {
        break;
      }
    }
    return out;
  }

  async file(path: string): Promise<RepoIndexFile | undefined> {
    const normalized = normalizePath(path);
    return this.files.find((file) => file.path === normalized);
  }

  async importsOf(path: string): Promise<RepoIndexEdge[]> {
    const normalized = normalizePath(path);
    return this.edges.filter(
      (edge) => edge.from === normalized && edge.kind === "import",
    );
  }

  async importersOf(path: string): Promise<RepoIndexEdge[]> {
    const normalized = normalizePath(path);
    const dir = dirOf(normalized);
    return this.edges.filter((edge) => {
      if (edge.kind !== "import") {
        return false;
      }
      return edge.to === normalized || edge.to === dir;
    });
  }
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function dirOf(path: string): string {
  const idx = path.lastIndexOf("/");
  if (idx <= 0) {
    return "";
  }
  return path.slice(0, idx);
}

async function readJsonl<T>(path: string): Promise<T[]> {
  const handle = await open(path, "r");
  try {
    const rl = createInterface({ input: handle.createReadStream(), crlfDelay: Infinity });
    const out: T[] = [];
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      out.push(JSON.parse(trimmed) as T);
    }
    return out;
  } finally {
    await handle.close();
  }
}

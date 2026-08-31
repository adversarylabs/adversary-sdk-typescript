import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const ADVERSARY_REPO_GRAPH_ENV = "ADVERSARY_REPO_GRAPH";
export const REPO_GRAPH_SCHEMA_VERSION = "v2";
export const REPO_GRAPH_ADAPTER_REVISION = "go-ast-v1+ts-syntax-v1";

export interface RepoGraphMeta {
  schemaVersion: string;
  adapterRevision: string;
  fingerprint: string;
  repoPath: string;
  builtAt: string;
  durationMs: number;
  fileCount: number;
  symbolCount: number;
  edgeCount: number;
  testLinkCount: number;
  parseFailures?: readonly RepoGraphDiagnostic[];
}

export interface RepoGraphDiagnostic {
  path: string;
  adapter: string;
  message: string;
}

export interface RepoGraphFile {
  id: number;
  path: string;
  language: string;
  size: number;
  hash: string;
  module?: string;
}

export interface RepoGraphSymbol {
  id: number;
  name: string;
  kind: string;
  path: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  containerId?: number;
  exported: boolean;
  language: string;
  metadata?: string;
}

export interface RepoGraphEdge {
  id: number;
  fromPath: string;
  fromSymbolId?: number;
  toPath?: string;
  toSymbolId?: number;
  unresolvedTarget?: string;
  kind: string;
  line: number;
  column: number;
  confidence: number;
  adapter: string;
}

export interface RepoGraphTestLink {
  sourcePath: string;
  sourceSymbolId?: number;
  testPath: string;
  testSymbolId?: number;
  confidence: number;
  reason: string;
}

export interface RepoGraphPage<T> {
  items: readonly T[];
  nextCursor?: string;
}

export interface RepoGraphFileQuery {
  language?: string;
  glob?: string;
  cursor?: string;
  limit?: number;
}

export interface RepoGraphSymbolQuery {
  path?: string;
  name?: string;
  kind?: string;
  cursor?: string;
  limit?: number;
}

export interface RepoGraphRelationQuery {
  symbolId: number;
  cursor?: string;
  limit?: number;
}

export interface RepoGraph {
  readonly dir: string;
  readonly meta: RepoGraphMeta;
  files(query?: RepoGraphFileQuery): RepoGraphPage<RepoGraphFile>;
  symbolAt(path: string, line: number, column?: number): RepoGraphSymbol | undefined;
  symbols(query?: RepoGraphSymbolQuery): RepoGraphPage<RepoGraphSymbol>;
  definitions(query: RepoGraphSymbolQuery): RepoGraphPage<RepoGraphSymbol>;
  references(query: RepoGraphRelationQuery): RepoGraphPage<RepoGraphEdge>;
  callers(query: RepoGraphRelationQuery): RepoGraphPage<RepoGraphEdge>;
  callees(query: RepoGraphRelationQuery): RepoGraphPage<RepoGraphEdge>;
  implementations(query: RepoGraphRelationQuery): RepoGraphPage<RepoGraphEdge>;
  importsOf(path: string, cursor?: string, limit?: number): RepoGraphPage<RepoGraphEdge>;
  importersOf(path: string, cursor?: string, limit?: number): RepoGraphPage<RepoGraphEdge>;
  relatedTests(options: {
    path?: string;
    symbolId?: number;
    cursor?: string;
    limit?: number;
  }): RepoGraphPage<RepoGraphTestLink>;
  close(): void;
}

export class RepoGraphUnavailableError extends Error {
  readonly code = "repo_graph_unavailable";

  constructor(message: string) {
    super(message);
    this.name = "RepoGraphUnavailableError";
  }
}

export async function openRepoGraph(dir: string): Promise<RepoGraph> {
  const raw = await readFile(join(dir, "meta.json"), "utf8");
  const meta = JSON.parse(raw) as RepoGraphMeta;
  if (
    meta.schemaVersion !== REPO_GRAPH_SCHEMA_VERSION ||
    meta.adapterRevision !== REPO_GRAPH_ADAPTER_REVISION
  ) {
    throw new RepoGraphUnavailableError(
      `unsupported repo-graph schema ${meta.schemaVersion}/${meta.adapterRevision}`,
    );
  }
  const database = new DatabaseSync(join(dir, "graph.sqlite"), { readOnly: true });
  return new SQLiteRepoGraph(dir, meta, database);
}

export async function repoGraphFromEnvironment(
  env: Record<string, string | undefined> = process.env,
): Promise<RepoGraph | null> {
  const dir = env[ADVERSARY_REPO_GRAPH_ENV]?.trim();
  if (!dir) return null;
  try {
    return await openRepoGraph(dir);
  } catch {
    return null;
  }
}

class SQLiteRepoGraph implements RepoGraph {
  constructor(
    readonly dir: string,
    readonly meta: RepoGraphMeta,
    private readonly database: DatabaseSync,
  ) {}

  files(query: RepoGraphFileQuery = {}): RepoGraphPage<RepoGraphFile> {
    const { limit, cursor } = bounds(query.limit, query.cursor);
    const glob = query.glob === undefined ? "" : globToLike(query.glob);
    const rows = this.database
      .prepare(`SELECT id,path,language,size,hash,module FROM files
      WHERE id > ? AND (? = '' OR language = ?) AND (? = '' OR path LIKE ? ESCAPE '\\')
      ORDER BY id LIMIT ?`)
      .all(cursor, query.language ?? "", query.language ?? "", glob, glob, limit + 1);
    return page(rows.map(fileRow), limit, (item) => item.id);
  }

  symbolAt(path: string, line: number, column = 0): RepoGraphSymbol | undefined {
    validPath(path);
    if (!Number.isInteger(line) || line < 1 || !Number.isInteger(column) || column < 0) {
      throw new Error("line must be positive and column non-negative");
    }
    const row = this.database
      .prepare(`${symbolSelect}
      WHERE f.path=? AND (s.start_line < ? OR (s.start_line=? AND s.start_col<=?))
      AND (s.end_line > ? OR (s.end_line=? AND s.end_col>=?))
      ORDER BY (s.end_line-s.start_line) ASC, s.id ASC LIMIT 1`)
      .get(normalizePath(path), line, line, column, line, line, column);
    return row === undefined ? undefined : symbolRow(row);
  }

  symbols(query: RepoGraphSymbolQuery = {}): RepoGraphPage<RepoGraphSymbol> {
    if (query.path !== undefined) validPath(query.path);
    const { limit, cursor } = bounds(query.limit, query.cursor);
    const rows = this.database
      .prepare(`${symbolSelect}
      WHERE s.id>? AND (?='' OR f.path=?) AND (?='' OR s.name=?) AND (?='' OR s.kind=?)
      ORDER BY s.id LIMIT ?`)
      .all(
        cursor,
        query.path ?? "",
        normalizePath(query.path ?? ""),
        query.name ?? "",
        query.name ?? "",
        query.kind ?? "",
        query.kind ?? "",
        limit + 1,
      );
    return page(rows.map(symbolRow), limit, (item) => item.id);
  }

  definitions(query: RepoGraphSymbolQuery): RepoGraphPage<RepoGraphSymbol> {
    return this.symbols(query);
  }

  references(query: RepoGraphRelationQuery): RepoGraphPage<RepoGraphEdge> {
    return this.relations(query, "references", false);
  }

  callers(query: RepoGraphRelationQuery): RepoGraphPage<RepoGraphEdge> {
    return this.relations(query, "calls", false);
  }

  callees(query: RepoGraphRelationQuery): RepoGraphPage<RepoGraphEdge> {
    return this.relations(query, "calls", true);
  }

  implementations(query: RepoGraphRelationQuery): RepoGraphPage<RepoGraphEdge> {
    return this.relations(query, "implements", false);
  }

  importsOf(path: string, cursor?: string, limit?: number): RepoGraphPage<RepoGraphEdge> {
    return this.fileRelations(path, cursor, limit, true);
  }

  importersOf(path: string, cursor?: string, limit?: number): RepoGraphPage<RepoGraphEdge> {
    return this.fileRelations(path, cursor, limit, false);
  }

  relatedTests(options: {
    path?: string;
    symbolId?: number;
    cursor?: string;
    limit?: number;
  }): RepoGraphPage<RepoGraphTestLink> {
    if (options.path !== undefined) validPath(options.path);
    const symbolId = options.symbolId ?? 0;
    if (!Number.isInteger(symbolId) || symbolId < 0)
      throw new Error("symbolId must be non-negative");
    const { limit, cursor } = bounds(options.limit, options.cursor);
    const rows = this.database
      .prepare(`SELECT tl.id,sf.path AS source_path,
      tl.source_symbol_id,tf.path AS test_path,tl.test_symbol_id,tl.confidence,tl.reason
      FROM test_links tl JOIN files sf ON sf.id=tl.source_file_id
      JOIN files tf ON tf.id=tl.test_file_id
      WHERE tl.id>? AND (?='' OR sf.path=?)
      AND (?=0 OR tl.source_symbol_id=? OR sf.id=(SELECT file_id FROM symbols WHERE id=?))
      ORDER BY tl.id LIMIT ?`)
      .all(
        cursor,
        options.path ?? "",
        normalizePath(options.path ?? ""),
        symbolId,
        symbolId,
        symbolId,
        limit + 1,
      );
    return testLinkPage(rows.map(testLinkRow), limit);
  }

  close(): void {
    this.database.close();
  }

  private relations(
    query: RepoGraphRelationQuery,
    kind: string,
    outgoing: boolean,
  ): RepoGraphPage<RepoGraphEdge> {
    if (!Number.isInteger(query.symbolId) || query.symbolId < 1) {
      throw new Error("symbolId must be positive");
    }
    const { limit, cursor } = bounds(query.limit, query.cursor);
    const column = outgoing ? "from_symbol_id" : "to_symbol_id";
    const rows = this.database
      .prepare(`${edgeSelect}
      WHERE e.id>? AND e.kind=? AND e.${column}=? ORDER BY e.id LIMIT ?`)
      .all(cursor, kind, query.symbolId, limit + 1);
    return page(rows.map(edgeRow), limit, (item) => item.id);
  }

  private fileRelations(
    path: string,
    cursorValue: string | undefined,
    limitValue: number | undefined,
    outgoing: boolean,
  ): RepoGraphPage<RepoGraphEdge> {
    validPath(path);
    const { limit, cursor } = bounds(limitValue, cursorValue);
    const condition = outgoing ? "ff.path=?" : "tf.module=(SELECT module FROM files WHERE path=?)";
    const rows = this.database
      .prepare(`${edgeSelect}
      WHERE e.id>? AND e.kind='imports' AND ${condition} ORDER BY e.id LIMIT ?`)
      .all(cursor, normalizePath(path), limit + 1);
    return page(rows.map(edgeRow), limit, (item) => item.id);
  }
}

const symbolSelect = `SELECT s.id,s.name,s.kind,f.path,s.start_line,s.start_col,
  s.end_line,s.end_col,s.container_id,s.exported,f.language,s.adapter_data
  FROM symbols s JOIN files f ON f.id=s.file_id`;

const edgeSelect = `SELECT e.id,ff.path AS from_path,e.from_symbol_id,
  COALESCE(tf.path,'') AS to_path,e.to_symbol_id,
  COALESCE(e.unresolved_target,'') AS unresolved_target,e.kind,e.line,e.column,
  e.confidence,e.adapter FROM edges e JOIN files ff ON ff.id=e.from_file_id
  LEFT JOIN files tf ON tf.id=e.to_file_id`;

interface RowRecord {
  [key: string]: unknown;
}

function fileRow(row: RowRecord): RepoGraphFile {
  return {
    id: number(row.id),
    path: text(row.path),
    language: text(row.language),
    size: number(row.size),
    hash: text(row.hash),
    ...(text(row.module) === "" ? {} : { module: text(row.module) }),
  };
}

function symbolRow(row: RowRecord): RepoGraphSymbol {
  return {
    id: number(row.id),
    name: text(row.name),
    kind: text(row.kind),
    path: text(row.path),
    startLine: number(row.start_line),
    startColumn: number(row.start_col),
    endLine: number(row.end_line),
    endColumn: number(row.end_col),
    ...(row.container_id === null ? {} : { containerId: number(row.container_id) }),
    exported: number(row.exported) !== 0,
    language: text(row.language),
    ...(text(row.adapter_data) === "" ? {} : { metadata: text(row.adapter_data) }),
  };
}

function edgeRow(row: RowRecord): RepoGraphEdge {
  return {
    id: number(row.id),
    fromPath: text(row.from_path),
    ...(row.from_symbol_id === null ? {} : { fromSymbolId: number(row.from_symbol_id) }),
    ...(text(row.to_path) === "" ? {} : { toPath: text(row.to_path) }),
    ...(row.to_symbol_id === null ? {} : { toSymbolId: number(row.to_symbol_id) }),
    ...(text(row.unresolved_target) === ""
      ? {}
      : { unresolvedTarget: text(row.unresolved_target) }),
    kind: text(row.kind),
    line: number(row.line),
    column: number(row.column),
    confidence: number(row.confidence),
    adapter: text(row.adapter),
  };
}

interface TestLinkWithID extends RepoGraphTestLink {
  id: number;
}

function testLinkRow(row: RowRecord): TestLinkWithID {
  return {
    id: number(row.id),
    sourcePath: text(row.source_path),
    ...(row.source_symbol_id === null ? {} : { sourceSymbolId: number(row.source_symbol_id) }),
    testPath: text(row.test_path),
    ...(row.test_symbol_id === null ? {} : { testSymbolId: number(row.test_symbol_id) }),
    confidence: number(row.confidence),
    reason: text(row.reason),
  };
}

function page<T>(items: T[], limit: number, id: (item: T) => number): RepoGraphPage<T> {
  const hasMore = items.length > limit;
  const bounded = hasMore ? items.slice(0, limit) : items;
  const nextCursor = hasMore ? String(id(bounded[bounded.length - 1] as T)) : undefined;
  return {
    items: bounded,
    ...(nextCursor === undefined ? {} : { nextCursor }),
  };
}

function testLinkPage(items: TestLinkWithID[], limit: number): RepoGraphPage<RepoGraphTestLink> {
  const bounded = page(items, limit, (item) => item.id);
  return {
    items: bounded.items.map(({ id: _id, ...item }) => item),
    ...(bounded.nextCursor === undefined ? {} : { nextCursor: bounded.nextCursor }),
  };
}

function bounds(limitValue?: number, cursorValue?: string): { limit: number; cursor: number } {
  const limit = limitValue ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new Error("limit must be an integer from 1 through 500");
  }
  const cursor = cursorValue === undefined || cursorValue === "" ? 0 : Number(cursorValue);
  if (!Number.isSafeInteger(cursor) || cursor < 0) {
    throw new Error("cursor must be a non-negative integer");
  }
  return { limit, cursor };
}

function validPath(path: string): void {
  const normalized = normalizePath(path);
  if (
    normalized === "" ||
    normalized.startsWith("/") ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    normalized.includes("\0") ||
    normalized.includes("//")
  ) {
    throw new Error("path must be normalized and repository-relative");
  }
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function globToLike(glob: string): string {
  if (glob.includes("..") || glob.startsWith("/") || glob.includes("\0")) {
    throw new Error("glob must be repository-relative");
  }
  return normalizePath(glob)
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_")
    .replaceAll("*", "%")
    .replaceAll("?", "_");
}

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  throw new Error("repo graph returned a non-string value");
}

function number(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  throw new Error("repo graph returned a non-number value");
}

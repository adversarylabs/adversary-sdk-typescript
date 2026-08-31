import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  ADVERSARY_REPO_GRAPH_ENV,
  openRepoGraph,
  repoGraphFromEnvironment,
} from "../src/repo-graph.js";

async function writeFixtureGraph(): Promise<string> {
  const dir = join(tmpdir(), `adversary-repo-graph-${Date.now()}-${Math.random()}`);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "meta.json"),
    `${JSON.stringify({
      schemaVersion: "v2",
      adapterRevision: "go-ast-v1+ts-syntax-v1",
      fingerprint: "fixture",
      repoPath: "/fixture",
      builtAt: new Date(0).toISOString(),
      durationMs: 1,
      fileCount: 2,
      symbolCount: 2,
      edgeCount: 2,
      testLinkCount: 1,
    })}\n`,
  );
  const db = new DatabaseSync(join(dir, "graph.sqlite"));
  db.exec(`
    CREATE TABLE files (id INTEGER PRIMARY KEY,path TEXT,language TEXT,size INTEGER,hash TEXT,module TEXT);
    CREATE TABLE symbols (id INTEGER PRIMARY KEY,file_id INTEGER,name TEXT,kind TEXT,start_line INTEGER,start_col INTEGER,end_line INTEGER,end_col INTEGER,container_id INTEGER,exported INTEGER,adapter_data TEXT);
    CREATE TABLE edges (id INTEGER PRIMARY KEY,from_file_id INTEGER,from_symbol_id INTEGER,to_file_id INTEGER,to_symbol_id INTEGER,unresolved_target TEXT,kind TEXT,line INTEGER,column INTEGER,confidence REAL,adapter TEXT);
    CREATE TABLE test_links (id INTEGER PRIMARY KEY,source_file_id INTEGER,source_symbol_id INTEGER,test_file_id INTEGER,test_symbol_id INTEGER,confidence REAL,reason TEXT);
    INSERT INTO files VALUES (1,'src/service.ts','typescript',10,'a','src/service.ts');
    INSERT INTO files VALUES (2,'src/service.test.ts','typescript',10,'b','src/service.test.ts');
    INSERT INTO symbols VALUES (1,1,'serve','function',1,0,4,1,NULL,1,'');
    INSERT INTO symbols VALUES (2,2,'testServe','function',1,0,3,1,NULL,0,'');
    INSERT INTO edges VALUES (1,2,2,1,1,NULL,'calls',2,1,1.0,'fixture');
    INSERT INTO edges VALUES (2,2,NULL,1,NULL,NULL,'imports',1,1,1.0,'fixture');
    INSERT INTO test_links VALUES (1,1,1,2,2,0.9,'filename');
  `);
  db.close();
  return dir;
}

describe("repo graph", () => {
  it("provides bounded symbol, relationship, and test queries", async () => {
    const dir = await writeFixtureGraph();
    const graph = await openRepoGraph(dir);
    expect(graph.symbolAt("src/service.ts", 2)?.name).toBe("serve");
    expect(graph.callers({ symbolId: 1 }).items[0]?.fromSymbolId).toBe(2);
    expect(graph.importersOf("src/service.ts").items[0]?.fromPath).toBe("src/service.test.ts");
    expect(graph.relatedTests({ symbolId: 1 }).items[0]?.testPath).toBe("src/service.test.ts");
    graph.close();
  });

  it("loads from the environment and degrades safely", async () => {
    const dir = await writeFixtureGraph();
    expect(await repoGraphFromEnvironment({ [ADVERSARY_REPO_GRAPH_ENV]: dir })).not.toBeNull();
    expect(await repoGraphFromEnvironment({})).toBeNull();
    expect(
      await repoGraphFromEnvironment({
        [ADVERSARY_REPO_GRAPH_ENV]: join(tmpdir(), "missing-repo-graph"),
      }),
    ).toBeNull();
  });

  it("rejects unsafe paths and unbounded queries", async () => {
    const graph = await openRepoGraph(await writeFixtureGraph());
    expect(() => graph.symbolAt("../secret", 1)).toThrow(/repository-relative/);
    expect(() => graph.files({ limit: 501 })).toThrow(/1 through 500/);
    graph.close();
  });
});

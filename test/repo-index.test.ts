import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ADVERSARY_REPO_INDEX_ENV,
  openRepoIndex,
  repoIndexFromEnvironment,
} from "../src/repo-index.js";

async function writeFixtureIndex(): Promise<string> {
  const dir = join(
    tmpdir(),
    `adversary-repo-index-test-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "meta.json"),
    `${JSON.stringify({
      schemaVersion: "v1",
      fingerprint: "test",
      repoPath: "/fixture",
      fileCount: 4,
      edgeCount: 2,
    })}\n`,
  );
  await writeFile(
    join(dir, "files.jsonl"),
    `${[
      JSON.stringify({ path: "pkg/a/a.go", language: "go", size: 10, hash: "a" }),
      JSON.stringify({ path: "pkg/b/b.go", language: "go", size: 10, hash: "b" }),
      JSON.stringify({ path: "src/util.ts", language: "typescript", size: 10, hash: "u" }),
      JSON.stringify({ path: "src/main.ts", language: "typescript", size: 10, hash: "m" }),
    ].join("\n")}\n`,
  );
  await writeFile(
    join(dir, "edges.jsonl"),
    `${[
      JSON.stringify({ from: "pkg/b/b.go", to: "pkg/a", kind: "import" }),
      JSON.stringify({ from: "src/main.ts", to: "src/util.ts", kind: "import" }),
    ].join("\n")}\n`,
  );
  return dir;
}

describe("repo index", () => {
  it("loads Go and TypeScript edges from CLI-format fixtures", async () => {
    const dir = await writeFixtureIndex();
    const index = await openRepoIndex(dir);
    expect(index.meta.schemaVersion).toBe("v1");
    const goFiles = await index.listFiles({ language: "go" });
    expect(goFiles.map((f) => f.path).sort()).toEqual(["pkg/a/a.go", "pkg/b/b.go"]);
    const tsFiles = await index.listFiles({ language: "typescript" });
    expect(tsFiles).toHaveLength(2);

    const goImports = await index.importsOf("pkg/b/b.go");
    expect(goImports).toEqual([{ from: "pkg/b/b.go", to: "pkg/a", kind: "import" }]);
    const goImporters = await index.importersOf("pkg/a");
    expect(goImporters.some((e) => e.from === "pkg/b/b.go")).toBe(true);

    const tsImports = await index.importsOf("src/main.ts");
    expect(tsImports[0]?.to).toBe("src/util.ts");
    const tsImporters = await index.importersOf("src/util.ts");
    expect(tsImporters[0]?.from).toBe("src/main.ts");
  });

  it("reads ADVERSARY_REPO_INDEX from the environment", async () => {
    const dir = await writeFixtureIndex();
    const index = await repoIndexFromEnvironment({
      [ADVERSARY_REPO_INDEX_ENV]: dir,
    });
    expect(index).not.toBeNull();
    const file = await index?.file("src/util.ts");
    expect(file?.language).toBe("typescript");
  });

  it("returns null when the env var is unset", async () => {
    const index = await repoIndexFromEnvironment({});
    expect(index).toBeNull();
  });

  it("returns null when ADVERSARY_REPO_INDEX points at a missing directory", async () => {
    const index = await repoIndexFromEnvironment({
      [ADVERSARY_REPO_INDEX_ENV]: join(tmpdir(), "adversary-repo-index-missing-dir"),
    });
    expect(index).toBeNull();
  });
});

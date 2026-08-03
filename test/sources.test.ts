import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listInScopePaths, loadInScopeSources } from "../src/sources.js";

async function fixtureRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "sdk-sources-"));
  await mkdir(join(root, "pkg", "weak"), { recursive: true });
  await mkdir(join(root, "node_modules", "x"), { recursive: true });
  await writeFile(join(root, "main.go"), "package main\n");
  await writeFile(
    join(root, "pkg", "weak", "tls.go"),
    "package weak\n// InsecureSkipVerify: true\n",
  );
  await writeFile(join(root, "node_modules", "x", "index.js"), "export {}\n");
  await writeFile(join(root, "readme.md"), "# hi\n");
  return root;
}

describe("in-scope sources", () => {
  it("uses change.changedFiles for changed mode including untracked paths", async () => {
    const root = await fixtureRepo();
    const paths = await listInScopePaths(
      root,
      {
        scanMode: "changed",
        changedFiles: ["pkg/weak/tls.go", "does-not-exist.go"],
      },
      { include: (path) => path.endsWith(".go") },
    );
    expect(paths).toEqual(["pkg/weak/tls.go", "does-not-exist.go"]);

    const sources = await loadInScopeSources(
      root,
      {
        scanMode: "changed",
        changedFiles: ["pkg/weak/tls.go", "does-not-exist.go"],
      },
      { include: (path) => path.endsWith(".go") },
    );
    expect(sources).toHaveLength(1);
    expect(sources[0]?.path).toBe("pkg/weak/tls.go");
    expect(sources[0]?.status).toBe("changed");
    expect(sources[0]?.content).toContain("InsecureSkipVerify");
  });

  it("walks the whole target for scanMode all and skips ignored dirs", async () => {
    const root = await fixtureRepo();
    const paths = await listInScopePaths(
      root,
      { scanMode: "all", changedFiles: [] },
      { include: (path) => path.endsWith(".go") },
    );
    expect(paths.sort()).toEqual(["main.go", "pkg/weak/tls.go"]);
    expect(paths.every((path) => !path.includes("node_modules"))).toBe(true);

    const sources = await loadInScopeSources(
      root,
      { scanMode: "all", changedFiles: [] },
      {
        include: (path) => path.endsWith(".go"),
      },
    );
    expect(sources.map((s) => s.status)).toEqual(["repository", "repository"]);
  });

  it("marks listed paths as changed even under scanMode all when present", async () => {
    const root = await fixtureRepo();
    const sources = await loadInScopeSources(
      root,
      { scanMode: "all", changedFiles: ["main.go"] },
      { include: (path) => path.endsWith(".go") },
    );
    const byPath = Object.fromEntries(sources.map((s) => [s.path, s.status]));
    expect(byPath["main.go"]).toBe("changed");
    expect(byPath["pkg/weak/tls.go"]).toBe("repository");
  });
});

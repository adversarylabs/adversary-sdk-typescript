import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import type { ModelReviewRequest, ReviewModel } from "../src/model.js";
import {
  type ModelRepositoryToolOptions,
  reviewWithRepositoryTools,
} from "../src/repository-model.js";

async function fixture(
  changedFiles: string[] = ["source.ts"],
  options: ModelRepositoryToolOptions = {},
  firstPlan: unknown = { ready: true, operations: [] },
  source = "export const value = 'source evidence';\nsecond line\nthird line\n",
  baseSource = "export const value = 'old';\nsecond line\nthird line\n",
  modeOnly = false,
  sourcePath = "source.ts",
  baseRef: string | undefined = "HEAD",
  untracked = false,
) {
  const root = await mkdtemp(join(tmpdir(), "sdk-source-recovery-"));
  try {
    execFileSync("git", ["-C", root, "init", "-q"]);
    await mkdir(join(root, sourcePath, ".."), { recursive: true });
    await writeFile(join(root, sourcePath), baseSource);
    execFileSync("git", ["-C", root, "add", sourcePath]);
    execFileSync("git", [
      "-C",
      root,
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.com",
      "commit",
      "-qm",
      "base",
    ]);
    await writeFile(join(root, sourcePath), source);
    if (modeOnly) await chmod(join(root, "source.ts"), 0o755);
    await mkdir(join(root, "vendor"), { recursive: true });
    await writeFile(join(root, "vendor", "hidden.ts"), "excluded source");
    await symlink(join(root, "source.ts"), join(root, "link.ts"));
    if (untracked) {
      execFileSync("git", ["-C", root, "rm", "--cached", sourcePath]);
      execFileSync("git", [
        "-C",
        root,
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.com",
        "commit",
        "-qm",
        "remove source",
      ]);
    }
    const indexBefore = execFileSync("git", ["-C", root, "ls-files", "--stage"], {
      encoding: "utf8",
    });
    const requests: ModelReviewRequest[] = [];
    let planningCalls = 0;
    let finalCalls = 0;
    const model: ReviewModel = {
      async review<T>(request: ModelReviewRequest) {
        requests.push(request);
        const planning = request.prompt.startsWith("REPOSITORY RETRIEVAL CONTROLLER:");
        if (planning) planningCalls += 1;
        else finalCalls += 1;
        return {
          output: (planning
            ? planningCalls === 1
              ? firstPlan
              : { ready: true, operations: [] }
            : { findings: [] }) as T,
          provider: "fixture",
          model: "same-model",
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      },
    };
    const result = await reviewWithRepositoryTools(
      model,
      root,
      {
        prompt: "Review the change.",
        input: {},
        schema: {
          type: "object",
          required: ["findings"],
          properties: { findings: { type: "array" } },
        },
        tools: { repository: { maxRounds: 4, ...options } },
      },
      { baseRef, changedFiles, worktree: true },
      "fixture-reviewer",
    );
    expect(execFileSync("git", ["-C", root, "ls-files", "--stage"], { encoding: "utf8" })).toBe(
      indexBefore,
    );
    return { result, requests, planningCalls, finalCalls };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

it.each([true, false])(
  "recovers an empty plan (ready=%s) before the final review",
  async (ready) => {
    const { result, requests, planningCalls, finalCalls } = await fixture(undefined, undefined, {
      ready,
      operations: [],
    });
    expect(planningCalls).toBe(3);
    expect(finalCalls).toBe(1);
    expect(result.retrieval).toMatchObject({
      filesRead: 1,
      toolCalls: 2,
      sourceReadRecoveries: 2,
      exhausted: false,
    });
    expect(result.citations?.[0].content).toContain("source evidence");
    expect(JSON.stringify(requests.at(-1)?.input)).toContain("repo:read:1");
    expect(result.usage).toEqual({ inputTokens: 4, outputTokens: 4 });
  },
);

it("leaves fully covered source plans alone", async () => {
  const { result } = await fixture(undefined, undefined, {
    ready: false,
    operations: [
      { tool: "read_change", path: "source.ts", cursor: 0, startLine: 0, endLine: 0 },
      { tool: "read_file", path: "source.ts", cursor: 0, startLine: 1, endLine: 3 },
    ],
  });
  expect(result.retrieval?.sourceReadRecoveries).toBeUndefined();
  expect(result.citations?.[0].content).toContain("second line");
});

it("recovers a failed model-selected source window", async () => {
  const { result, planningCalls } = await fixture(undefined, undefined, {
    ready: false,
    operations: [
      { tool: "read_file", path: "source.ts", cursor: 0, startLine: 1000, endLine: 1010 },
    ],
  });
  expect(planningCalls).toBe(4);
  expect(result.retrieval).toMatchObject({ filesRead: 1, toolCalls: 3, sourceReadRecoveries: 2 });
});

it("cannot complete recovery through missing source, symlinks, or traversal", async () => {
  for (const path of ["missing.ts", "link.ts", "../secret.ts", "/secret.ts"])
    await expect(fixture([path])).rejects.toThrow(/no source evidence for all changed hunks/);
});

it("recovers only in-scope changed files", async () => {
  const { result } = await fixture(["vendor/hidden.ts", "source.ts"], {
    exclude: ["**/vendor/**"],
  });
  expect(result.citations?.map((c) => c.path)).toEqual(["source.ts"]);
});

it("obeys existing line and tool limits", async () => {
  const { result } = await fixture(undefined, { maxLinesPerRead: 1, maxToolCalls: 4 });
  expect(result.retrieval).toMatchObject({ filesRead: 3, toolCalls: 4, exhausted: true });
  expect(result.citations?.every((c) => c.startLine === c.endLine)).toBe(true);
  await expect(fixture(undefined, { maxToolCalls: 2, maxLinesPerRead: 1 })).rejects.toThrow(
    /no source evidence for all changed hunks/,
  );
});

it("does not force source reads when there is no changed-file context", async () => {
  const { result, planningCalls } = await fixture([]);
  expect(planningCalls).toBe(1);
  expect(result.retrieval?.sourceReadRecoveries).toBeUndefined();
});

it("recovers a planner that repeats an already completed directory operation", async () => {
  const { result } = await fixture(undefined, undefined, {
    ready: false,
    operations: [{ tool: "list_directory", path: ".", cursor: 0, startLine: 0, endLine: 0 }],
  });
  expect(result.retrieval).toMatchObject({ filesRead: 1, sourceReadRecoveries: 2 });
});

it("does not finish if rounds or bytes run out before changed hunks are read", async () => {
  await expect(fixture(undefined, { maxRounds: 1 })).rejects.toThrow(
    /no source evidence for all changed hunks/,
  );
  await expect(
    fixture(undefined, { maxTotalBytes: 4096 }, undefined, "x".repeat(6000)),
  ).rejects.toThrow(/no source evidence for all changed hunks/);
});

it("reads a changed line500 instead of satisfying recovery with unchanged prefixes", async () => {
  const prefix = Array.from({ length: 499 }, (_, i) => `// line ${i + 1}`).join("\n");
  const source = `${prefix}\nexport const value = 'changed500';\n`;
  const base = `${prefix}\nexport const value = 'old';\n`;
  const { result } = await fixture(undefined, {}, undefined, source, base);
  expect(
    result.citations?.some(
      (c) => c.startLine <= 500 && c.endLine >= 500 && c.content.includes("changed500"),
    ),
  ).toBe(true);
});

it("unrelated prefix citations cannot bypass patch or changed-line recovery", async () => {
  const prefix = "// unchanged\n".repeat(499);
  const { result } = await fixture(
    undefined,
    {},
    {
      ready: false,
      operations: [{ tool: "read_file", path: "source.ts", cursor: 0, startLine: 1, endLine: 200 }],
    },
    `${prefix}changed500\n`,
    `${prefix}old500\n`,
  );
  expect(result.retrieval?.sourceReadRecoveries).toBeGreaterThan(0);
  expect(
    result.citations?.some(
      (c) => c.startLine <= 500 && c.endLine >= 500 && c.content.includes("changed500"),
    ),
  ).toBe(true);
});

it("mode-only and binary patches complete without nonexistent text reads", async () => {
  const text = "export const value = 0;\n";
  const mode = await fixture(undefined, {}, undefined, text, text, true);
  expect(mode.result.retrieval).toMatchObject({ filesRead: 0, changedHunksCovered: true });
  const binary = await fixture(undefined, {}, undefined, "\0new", "\0old");
  expect(binary.result.retrieval).toMatchObject({ filesRead: 0, changedHunksCovered: true });
});

it.each(["docs/vendor/helm-install-release.md", "vendor/guide.md"])(
  "reads changed source and patches in a folder named vendor: %s",
  async (path) => {
    const { result, requests } = await fixture(
      [path],
      {},
      undefined,
      undefined,
      undefined,
      false,
      path,
    );
    expect(result.retrieval?.changedHunksCovered).toBe(true);
    expect(
      result.citations?.some((c) => c.path === path && c.content.includes("source evidence")),
    ).toBe(true);
    const input = requests.at(-1)?.input as {
      repository: { toolResults: Array<{ tool: string; path: string; content?: string }> };
    };
    expect(
      input.repository.toolResults.some(
        (r) =>
          r.tool === "read_change" && r.path === path && r.content?.includes("source evidence"),
      ),
    ).toBe(true);
  },
);

it.each([{ exclude: ["**/*.ts"] }, { include: ["**/*.go"] }])(
  "completes an entirely out-of-scope change: %j",
  async (options) => {
    const { result, planningCalls } = await fixture(["source.ts"], options);
    expect(planningCalls).toBe(1);
    expect(result.retrieval?.toolCalls).toBe(0);
  },
);

it("captures untracked worktree text without changing the index", async () => {
  const { result } = await fixture(
    undefined,
    {},
    undefined,
    undefined,
    undefined,
    false,
    "source.ts",
    "HEAD",
    true,
  );
  expect(result.retrieval?.changedHunksCovered).toBe(true);
  expect(result.citations?.[0].content).toContain("source evidence");
});

it("rejects a missing base revision before asking the model to plan", async () => {
  const model: ReviewModel = { review: vi.fn() };
  await expect(
    reviewWithRepositoryTools(
      model,
      ".",
      {
        prompt: "review",
        input: {},
        schema: {},
        tools: { repository: {} },
      },
      { changedFiles: ["source.ts"], worktree: true },
    ),
  ).rejects.toMatchObject({ code: "invalid_model_request" });
  expect(model.review).not.toHaveBeenCalled();
});

it("reports files outside the 500-file summary as a gap without claiming full coverage", async () => {
  const { result, requests } = await fixture(
    ["source.ts", ...Array.from({ length: 499 }, (_, i) => `excluded-${i}.go`), "omitted.ts"],
    { include: ["**/*.ts"] },
  );
  expect(result.retrieval?.omittedChangedFiles).toBe(1);
  expect(result.retrieval?.changedHunksCovered).toBeUndefined();
  expect(JSON.stringify(requests.at(-1)?.input)).toContain('"omittedChangedFiles":1');
});

it("emits stage diagnostics and exposes failure counts without source or prompt content", async () => {
  const log = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  try {
    await expect(fixture(undefined, { maxRounds: 1 })).rejects.toMatchObject({
      diagnostics: {
        stage: "repository_evidence_recovery",
        hunkCount: 1,
        coveredHunkCount: 0,
        sourceCount: 0,
        retrievalCalls: { read_change: 1, read_file: 0, failed: 0 },
        reasons: ["source_window_not_covered"],
      },
    });
    expect(
      log.mock.calls.some(([value]) => String(value).includes('"reviewer":"fixture-reviewer"')),
    ).toBe(true);
    const output = log.mock.calls.map(([value]) => String(value)).join("");
    expect(output).toContain('"stage":"repository_evidence_recovery"');
    expect(output).not.toContain("source evidence");
    expect(output).not.toContain("Review the change");
    expect(output).not.toContain("source.ts");
  } finally {
    log.mockRestore();
  }
});

import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
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
) {
  const root = await mkdtemp(join(tmpdir(), "sdk-source-recovery-"));
  try {
    execFileSync("git", ["-C", root, "init", "-q"]);
    await writeFile(join(root, "source.ts"), baseSource);
    execFileSync("git", ["-C", root, "add", "source.ts"]);
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
    await writeFile(join(root, "source.ts"), source);
    await mkdir(join(root, "vendor"));
    await writeFile(join(root, "vendor", "hidden.ts"), "excluded source");
    await symlink(join(root, "source.ts"), join(root, "link.ts"));
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
      { baseRef: "HEAD", changedFiles, worktree: true },
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

it("leaves successful source plans alone", async () => {
  const { result } = await fixture(undefined, undefined, {
    ready: false,
    operations: [{ tool: "read_file", path: "source.ts", cursor: 0, startLine: 2, endLine: 2 }],
  });
  expect(result.retrieval?.sourceReadRecoveries).toBeUndefined();
  expect(result.citations?.[0].content).toBe("second line");
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
  const { result } = await fixture(["vendor/hidden.ts", "source.ts"]);
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

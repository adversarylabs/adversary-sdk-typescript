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
) {
  const root = await mkdtemp(join(tmpdir(), "sdk-source-recovery-"));
  try {
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
      { changedFiles, worktree: true },
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
    expect(planningCalls).toBe(2);
    expect(finalCalls).toBe(1);
    expect(result.retrieval).toMatchObject({
      filesRead: 1,
      toolCalls: 1,
      sourceReadRecoveries: 1,
      exhausted: false,
    });
    expect(result.citations?.[0].content).toContain("source evidence");
    expect(JSON.stringify(requests.at(-1)?.input)).toContain("repo:read:1");
    expect(result.usage).toEqual({ inputTokens: 3, outputTokens: 3 });
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
  expect(planningCalls).toBe(3);
  expect(result.retrieval).toMatchObject({ filesRead: 1, toolCalls: 2, sourceReadRecoveries: 1 });
});

it("respects exclusions and blocks traversal and symlinks in recovery", async () => {
  const { result, requests } = await fixture([
    "../secret.ts",
    "/secret.ts",
    "link.ts",
    "vendor/hidden.ts",
    "source.ts",
  ]);
  expect(result.citations?.map((c) => c.path)).toEqual(["source.ts"]);
  expect(JSON.stringify(requests.at(-1)?.input)).not.toContain("excluded source");
});

it("does not repeat failed recovery reads and advances to the next bounded batch", async () => {
  const missing = Array.from({ length: 8 }, (_, i) => `missing-${i}.ts`);
  const { result, planningCalls } = await fixture([...missing, "source.ts"]);
  expect(planningCalls).toBe(3);
  expect(result.retrieval).toMatchObject({ filesRead: 1, toolCalls: 9, sourceReadRecoveries: 2 });
});

it("obeys existing line and tool limits without fabricating evidence", async () => {
  const limited = await fixture(undefined, { maxLinesPerRead: 1, maxToolCalls: 1, maxRounds: 1 });
  expect(limited.result.retrieval).toMatchObject({
    filesRead: 1,
    toolCalls: 1,
    rounds: 1,
    exhausted: true,
  });
  expect(limited.result.citations?.[0].endLine).toBe(1);
  const missing = await fixture(["missing.ts"], { maxToolCalls: 1 });
  expect(missing.result.retrieval).toMatchObject({ filesRead: 0, toolCalls: 1, exhausted: true });
  expect(missing.result.citations).toEqual([]);
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
  expect(result.retrieval).toMatchObject({ filesRead: 1, sourceReadRecoveries: 1 });
});

it("uses the final planning round for source instead of another directory listing", async () => {
  const { result } = await fixture(
    undefined,
    { maxRounds: 1 },
    {
      ready: false,
      operations: [{ tool: "list_directory", path: "vendor", cursor: 0, startLine: 0, endLine: 0 }],
    },
  );
  expect(result.retrieval).toMatchObject({
    filesRead: 1,
    rounds: 1,
    toolCalls: 1,
    sourceReadRecoveries: 1,
  });
});

it("does not admit citations that exceed the remaining byte budget", async () => {
  const { result } = await fixture(undefined, { maxTotalBytes: 4096 }, undefined, "x".repeat(6000));
  expect(result.retrieval).toMatchObject({ filesRead: 0, exhausted: true });
  expect(result.citations).toEqual([]);
  expect(result.retrieval?.bytes).toBeLessThanOrEqual(4096);
});

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { ModelReviewRequest, ReviewModel } from "../src/model.js";
import { reviewWithRepositoryTools } from "../src/repository-model.js";

// Customer source remains outside this repository. Supply an isolated checkout
// of the recorded head with the base object fetched; never execute target code.
const root = process.env.SDK_REPLAY_REPOSITORY;
const job = JSON.parse(
  readFileSync(new URL("./fixtures/recovery-job-d5d35cd6.json", import.meta.url), "utf8"),
) as {
  jobId: string;
  headRef: string;
  baseRef: string;
  reviewer: string;
  changedFiles: string[];
};

describe.skipIf(root === undefined)("recorded job d5d35cd6 source replay", () => {
  async function replay(maxToolCalls: number, finalRequests: ModelReviewRequest[]) {
    if (root === undefined) throw new Error("SDK_REPLAY_REPOSITORY is required");
    const git = (...args: string[]) =>
      execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
    expect(git("rev-parse", "HEAD")).toBe(job.headRef);
    expect(git("status", "--porcelain")).toBe("");
    expect(git("diff", "--name-only", job.baseRef, job.headRef).split("\n")).toEqual(
      job.changedFiles,
    );
    const model: ReviewModel = {
      async review<T>(request: ModelReviewRequest) {
        const planning = request.prompt.startsWith("REPOSITORY RETRIEVAL CONTROLLER:");
        if (!planning) finalRequests.push(request);
        return {
          output: (planning ? { ready: true, operations: [] } : { replayComplete: true }) as T,
          provider: "fixture",
          model: "deterministic-planner",
        };
      },
    };
    return reviewWithRepositoryTools(
      model,
      root,
      {
        prompt: "Replay repository evidence retrieval only.",
        input: {},
        schema: {
          type: "object",
          required: ["replayComplete"],
          properties: { replayComplete: { type: "boolean" } },
        },
        tools: { repository: { maxRounds: 16, maxToolCalls } },
      },
      {
        baseRef: job.baseRef,
        headRef: job.headRef,
        changedFiles: job.changedFiles,
        worktree: false,
      },
      job.reviewer,
    );
  }

  it("covers every changed file at the recorded head with the proposed bounded budget", async () => {
    const finalRequests: ModelReviewRequest[] = [];
    const result = await replay(128, finalRequests);
    expect(result.retrieval?.changedHunksCovered).toBe(true);
    expect(new Set(result.citations?.map((c) => c.path))).toEqual(new Set(job.changedFiles));
    expect(finalRequests).toHaveLength(1);
    expect(result.output).toEqual({ replayComplete: true });
  });

  it("reports the exact SDK recovery stage while finishing with zero source evidence", async () => {
    const log = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    vi.stubEnv("HOSTED_REVIEW_JOB_ID", job.jobId);
    const finalRequests: ModelReviewRequest[] = [];
    try {
      const result = await replay(1, finalRequests);
      expect(result.retrieval).toMatchObject({
        filesRead: 0,
        exhausted: true,
        changedHunksCovered: false,
        coverage: { status: "partial" },
      });
      const events = log.mock.calls
        .map(([value]) => String(value))
        .filter((value) => value.startsWith('{"event":"repository.coverage-gap"'))
        .map((value) => JSON.parse(value));
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        job_id: job.jobId,
        reviewer: job.reviewer,
        sourceCount: 0,
      });
      expect(events[0].hunkCount).toBeGreaterThan(0);
      expect(events[0].retrievalCalls).toEqual({ read_change: 1, read_file: 0, failed: 0 });
      expect(finalRequests).toHaveLength(1);
      for (const path of job.changedFiles) expect(JSON.stringify(events)).not.toContain(path);
    } finally {
      log.mockRestore();
      vi.unstubAllEnvs();
    }
  });
});

import { expect, it, vi } from "vitest";
import {
  BrokerReviewModel,
  type ModelReviewRequest,
  type ReviewModel,
  rewriteOpinionConcern,
} from "../src/index.js";

it("defaults broker requests to ten minutes, preserves explicit budgets, and rejects larger ones", async () => {
  const budgets: number[] = [];
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, options) => {
    budgets.push(JSON.parse(String(options?.body)).budget.timeoutMs);
    return new Response(
      JSON.stringify({
        protocolVersion: 1,
        provider: "fixture",
        model: "fixture",
        output: {},
      }),
      { headers: { "content-type": "application/json" } },
    );
  });
  try {
    const model = new BrokerReviewModel("http://127.0.0.1:43123/v1/review", "fixture");
    const request = {
      prompt: "Review prepared evidence.",
      input: {},
      schema: { type: "object" },
    };
    await model.review(request);
    await model.review({ ...request, budget: { timeoutMs: 1_234 } });
    expect(budgets).toEqual([600_000, 1_234]);
    await expect(
      model.review({ ...request, budget: { timeoutMs: 600_001 } }),
    ).rejects.toMatchObject({ code: "invalid_model_budget" });
  } finally {
    fetch.mockRestore();
  }
});

it("concern rewrites inherit ten minutes while preserving explicit shorter budgets", async () => {
  const requests: ModelReviewRequest[] = [];
  const model: ReviewModel = {
    async review<T>(request: ModelReviewRequest) {
      requests.push(request);
      return {
        output: { concern: "deployment failure" } as T,
        provider: "fixture",
        model: "fixture",
      };
    },
  };
  await rewriteOpinionConcern(model, { text: "The deployment fails." });
  await rewriteOpinionConcern(model, {
    text: "The deployment fails.",
    budget: { timeoutMs: 1_234 },
  });
  expect(requests.map((request) => request.budget?.timeoutMs)).toEqual([600_000, 1_234]);
});

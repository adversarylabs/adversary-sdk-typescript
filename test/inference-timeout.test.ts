import { Agent, type Dispatcher } from "undici";
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

it("overrides fetch's five-minute transport timeout with each advertised deadline", async () => {
  const deadlines: number[] = [];
  const destroyed: boolean[] = [];
  const dispatch = vi.spyOn(Agent.prototype, "dispatch").mockImplementation((options) => {
    deadlines.push(options.headersTimeout ?? 0, options.bodyTimeout ?? 0);
    return true;
  });
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, options) => {
    const dispatcher = (options as RequestInit & { dispatcher: Agent }).dispatcher;
    dispatcher.dispatch(
      {
        origin: "http://127.0.0.1:43123",
        path: "/v1/review",
        method: "POST",
        headersTimeout: 300_000,
        bodyTimeout: 300_000,
      },
      {} as Dispatcher.DispatchHandlers,
    );
    destroyed.push(dispatcher.destroyed);
    return new Response(
      JSON.stringify({ protocolVersion: 1, provider: "fixture", model: "fixture", output: {} }),
    );
  });
  try {
    const model = new BrokerReviewModel("http://127.0.0.1:43123/v1/review", "fixture");
    await model.review({ prompt: "Review.", input: {}, schema: { type: "object" } });
    await model.review({
      prompt: "Review.",
      input: {},
      schema: { type: "object" },
      budget: { timeoutMs: 1_234 },
    });
    expect(deadlines).toEqual([600_000, 600_000, 1_234, 1_234]);
    expect(destroyed).toEqual([false, false]);
    for (const [, options] of fetch.mock.calls) {
      expect((options as RequestInit & { dispatcher: Agent }).dispatcher.destroyed).toBe(true);
    }
  } finally {
    fetch.mockRestore();
    dispatch.mockRestore();
  }
});

it("does not retry deterministic broker limits even with an HTTP 502 status", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        protocolVersion: 1,
        error: {
          code: "model_response_limit",
          message: "concentrate answer exceeds byte limit",
          retryable: false,
        },
      }),
      { status: 502 },
    ),
  );
  try {
    const model = new BrokerReviewModel("http://127.0.0.1:43123/v1/review", "fixture");
    await expect(
      model.review({ prompt: "Review.", input: {}, schema: { type: "object" } }),
    ).rejects.toMatchObject({ code: "model_response_limit", retryable: false });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(
      (fetch.mock.calls[0][1] as RequestInit & { dispatcher: Agent }).dispatcher.destroyed,
    ).toBe(true);
  } finally {
    fetch.mockRestore();
  }
});

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import {
  Adversary,
  Confidence,
  ModelReviewError,
  type ModelReviewRequest,
  Severity,
  recoverReviewCandidates,
  validateReviewText,
} from "../src/index.js";

type Candidate = { id: string; summary: string; evidence: string[] };
const good: Candidate = {
  id: "good",
  summary: "The retry loses the original request body.",
  evidence: ["immutable-citation"],
};
const bad: Candidate = { ...good, id: "bad", summary: "summary" };
const validate = (c: Candidate) =>
  validateReviewText(c.summary, { field: "summary", minimumLength: 20, maximumLength: 800 });
it("withholds custom invalid values without repairing unselected fields", async () => {
  const f = fixture();
  const result = await recoverReviewCandidates(f.context, {
    candidates: [bad, good],
    validate: (candidate) =>
      candidate.id === "bad" ? [{ field: "evidence", code: "invalid_value" }] : [],
    repair: f.repair,
  });
  expect(result.candidates).toEqual([good]);
  expect(result.withheld).toEqual([
    { index: 0, issues: [{ field: "evidence", code: "invalid_value" }] },
  ]);
  expect(f.review).not.toHaveBeenCalled();
  expect(f.incomplete).toHaveBeenCalledWith("candidate_validation");
});
function fixture(output: unknown = { summary: "The retry loses the original request body." }) {
  const incomplete = vi.fn();
  const review = vi.fn(async <T>(_r: ModelReviewRequest<T>) => ({
    output: output as T,
    provider: "fixture",
    model: "fixture",
  }));
  const context = { model: { review }, review: { incomplete } };
  const repair = {
    fields: ["summary"] as const,
    request: () => ({
      prompt: "Repair only the summary.",
      input: {},
      schema: { type: "object" },
      budget: { timeoutMs: 1234 },
    }),
  };
  return { context, review, incomplete, repair };
}
it("repairs only rejected fields, preserving identity, evidence and valid peers", async () => {
  const f = fixture({ summary: good.summary, id: "invented", evidence: ["invented"] });
  const result = await recoverReviewCandidates(f.context, {
    candidates: [good, bad],
    validate,
    repair: f.repair,
  });
  expect(result.candidates).toEqual([good, { ...bad, summary: good.summary }]);
  expect(bad.summary).toBe("summary");
  expect(result.repaired).toBe(1);
  expect(result.withheld).toEqual([]);
  expect(f.review).toHaveBeenCalledTimes(1);
  expect(f.incomplete).not.toHaveBeenCalled();
  expect(f.review.mock.calls[0][0].budget?.timeoutMs).toBe(1234);
});
it("withholds unrepaired candidates and retains valid peers", async () => {
  const f = fixture({ summary: "still too short" });
  const result = await recoverReviewCandidates(f.context, {
    candidates: [bad, good],
    validate,
    repair: f.repair,
  });
  expect(result.candidates).toEqual([good]);
  expect(result.withheld[0].index).toBe(0);
  expect(result.withheld[0].issues[0].code).toBe("too_short");
  expect(f.incomplete).toHaveBeenCalledWith("candidate_validation");
});
it("limits repair calls across a batch and validates later good candidates", async () => {
  const f = fixture();
  const result = await recoverReviewCandidates(f.context, {
    candidates: [bad, bad, bad, good],
    validate,
    repair: f.repair,
    maximumRepairCalls: 1,
  });
  expect(result.repairCalls).toBe(1);
  expect(result.withheld).toHaveLength(2);
  expect(result.candidates).toEqual([{ ...bad, summary: good.summary }, good]);
});
it("reserves repair budget for candidates whose rejected fields are all repairable", async () => {
  const f = fixture();
  const unrecoverable = { ...bad, id: "unrecoverable" };
  const result = await recoverReviewCandidates(f.context, {
    candidates: [unrecoverable, bad, good],
    validate: (candidate) => [
      ...validate(candidate),
      ...(candidate.id === "unrecoverable"
        ? [{ field: "evidence", code: "invalid_value" as const }]
        : []),
    ],
    repair: f.repair,
    maximumRepairCalls: 1,
  });
  expect(result.candidates).toEqual([{ ...bad, summary: good.summary }, good]);
  expect(result.withheld.map(({ index }) => index)).toEqual([0]);
  expect(result.repairCalls).toBe(1);
  expect(f.review).toHaveBeenCalledTimes(1);
  expect(f.incomplete).toHaveBeenCalledWith("candidate_validation");
});
it.each([0, -1, 600_001, 1.5, Number.NaN])(
  "reports invalid repair timeout %s with the standard budget error code",
  async (timeoutMs) => {
    const f = fixture();
    await expect(
      recoverReviewCandidates(f.context, {
        candidates: [bad],
        validate,
        repair: {
          ...f.repair,
          request: () => ({ ...f.repair.request(), budget: { timeoutMs } }),
        },
      }),
    ).rejects.toMatchObject({ name: "ModelReviewError", code: "invalid_model_budget" });
    expect(f.review).not.toHaveBeenCalled();
    expect(f.incomplete).not.toHaveBeenCalled();
  },
);
it("a repair transport failure does not erase valid findings or leak its error body", async () => {
  const f = fixture();
  f.review.mockRejectedValue(new ModelReviewError("PRIVATE BODY", { code: "model_timeout" }));
  const log = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  try {
    const result = await recoverReviewCandidates(f.context, {
      candidates: [bad, good],
      validate,
      repair: f.repair,
    });
    expect(result.candidates).toEqual([good]);
    expect(result.withheld).toHaveLength(1);
    const text = log.mock.calls.map(([value]) => String(value)).join("");
    expect(text).toContain('"code":"too_short"');
    expect(text).not.toMatch(/PRIVATE BODY|immutable-citation|original request body/);
  } finally {
    log.mockRestore();
  }
});
it.each([
  "invalid_model_request",
  "model_request_too_large",
  "invalid_model_schema",
  "invalid_model_budget",
  "invalid_broker_endpoint",
  "invalid_broker_token",
])("propagates repair request/configuration errors: %s", async (code) => {
  const f = fixture();
  const error = new ModelReviewError("Request configuration is invalid", { code });
  f.review.mockRejectedValue(error);
  await expect(
    recoverReviewCandidates(f.context, {
      candidates: [bad, good],
      validate,
      repair: f.repair,
    }),
  ).rejects.toBe(error);
  expect(f.incomplete).not.toHaveBeenCalled();
});
it("withholds malformed repair responses while preserving valid peers", async () => {
  const f = fixture(null);
  const result = await recoverReviewCandidates(f.context, {
    candidates: [bad, good],
    validate,
    repair: f.repair,
  });
  expect(result.candidates).toEqual([good]);
  expect(result.withheld).toHaveLength(1);
  expect(f.incomplete).toHaveBeenCalledWith("candidate_validation");
});
it("does not swallow validator or repair-builder programming errors", async () => {
  const f = fixture();
  await expect(
    recoverReviewCandidates(f.context, {
      candidates: [bad],
      validate: () => {
        throw new Error("validator bug");
      },
    }),
  ).rejects.toThrow("validator bug");
  await expect(
    recoverReviewCandidates(f.context, {
      candidates: [bad],
      validate,
      repair: {
        fields: ["summary"],
        request: () => {
          throw new Error("builder bug");
        },
      },
    }),
  ).rejects.toThrow("builder bug");
});
it("uses one shared deadline rather than renewing it per candidate", async () => {
  const f = fixture();
  const now = vi.spyOn(performance, "now");
  now.mockReturnValueOnce(0).mockReturnValue(2000);
  try {
    const result = await recoverReviewCandidates(f.context, {
      candidates: [bad, good],
      validate,
      repair: f.repair,
      timeoutMs: 1000,
    });
    expect(f.review).not.toHaveBeenCalled();
    expect(result.candidates).toEqual([good]);
    expect(result.withheld).toHaveLength(1);
  } finally {
    now.mockRestore();
  }
});
it("reports exact prose rejection reasons without logging prose", () => {
  const limits = { field: "summary", minimumLength: 2, maximumLength: 80 };
  expect(validateReviewText("summary", limits)[0].code).toBe("placeholder");
  expect(validateReviewText("", limits)[0].code).toBe("too_short");
  expect(validateReviewText("x".repeat(81), limits)[0].code).toBe("too_long");
  expect(validateReviewText("Repeat. Repeat. Repeat. Repeat.", limits)[0].code).toBe("repetition");
  expect(validateReviewText(null, limits)[0].code).toBe("missing");
  expect(validateReviewText(3, limits)[0].code).toBe("invalid_type");
});
it("guards both explicit and synthesized clean opinions, even from later rules", async () => {
  const root = await mkdtemp(join(tmpdir(), "sdk-candidate-guard-"));
  try {
    for (const [explicit, retain] of [
      [true, false],
      [false, false],
      [true, true],
      [false, true],
    ]) {
      const app = new Adversary({ name: "fixture" });
      app.rule("first", async (ctx) => {
        await recoverReviewCandidates(ctx, { candidates: [bad], validate });
        if (retain)
          ctx.finding({
            ruleId: "retained",
            title: "A supported finding",
            category: "correctness",
            severity: Severity.High,
            confidence: Confidence.High,
            summary: good.summary,
            evidence: [{ file: "file.ts", line: 1 }],
          });
      });
      app.rule("later", (ctx) => {
        if (explicit) {
          ctx.review.assessment({ risk: "none", summary: "Everything is clean." });
          ctx.review.opinion({ ship: true, summary: "Ship it." });
        }
      });
      const result = await app.run({ input: { source: { path: root } } });
      expect(result.findings).toHaveLength(retain ? 1 : 0);
      expect(result.opinion?.ship).not.toBe(true);
      expect(result.opinion?.summary).toContain("limited coverage");
      expect(result.assessment?.summary).toContain("limited coverage");
      expect(result.assessment?.risk).toBe(retain ? "high" : "none");
      expect(result.observations.some((n) => n.metadata?.incomplete === true)).toBe(true);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("keeps an explicit blocking opinion under incomplete coverage", async () => {
  const root = await mkdtemp(join(tmpdir(), "sdk-candidate-block-"));
  try {
    const app = new Adversary({ name: "fixture" });
    app.rule("first", (ctx) => {
      ctx.review.incomplete("assessment_validation");
      ctx.review.opinion({ ship: false, summary: "Fix the finding." });
      ctx.review.opinion({ ship: true, summary: "A later approval cannot erase the block." });
    });
    const result = await app.run({ input: { source: { path: root } } });
    expect(result.opinion?.ship).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("shrinks successive repair budgets without changing output-token settings", async () => {
  const f = fixture();
  const now = vi
    .spyOn(performance, "now")
    .mockReturnValueOnce(0)
    .mockReturnValueOnce(100)
    .mockReturnValue(800);
  try {
    const result = await recoverReviewCandidates(f.context, {
      candidates: [bad, bad],
      validate,
      timeoutMs: 1000,
      repair: {
        fields: ["summary"],
        request: () => ({
          prompt: "Repair.",
          input: {},
          schema: { type: "object" },
          budget: { maximumOutputTokens: 1000 },
        }),
      },
    });
    expect(result.repaired).toBe(2);
    expect(f.review.mock.calls.map(([r]) => r.budget?.timeoutMs)).toEqual([900, 200]);
    expect(f.review.mock.calls.map(([r]) => r.budget?.maximumOutputTokens)).toEqual([1000, 1000]);
  } finally {
    now.mockRestore();
  }
});

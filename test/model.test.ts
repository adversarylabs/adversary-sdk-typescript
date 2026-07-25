import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  ADVERSARY_MODEL_PROTOCOL_VERSION,
  Adversary,
  BrokerReviewModel,
  type ModelReviewError,
  type ModelReviewRequest,
  ModelUnavailableError,
  type ReviewModel,
  unavailableModel,
} from "../src/index.js";

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error === undefined ? resolve() : reject(error))),
          ),
      ),
  );
});

describe("model review capability", () => {
  it("exposes an injectable provider-neutral model on rule context", async () => {
    const requests: ModelReviewRequest[] = [];
    const model: ReviewModel = {
      async review<T>(request: ModelReviewRequest) {
        requests.push(request);
        return {
          output: { verdict: "approve" } as T,
          provider: "fixture",
          model: "staff-reviewer",
        };
      },
    };
    const app = new Adversary({ name: "adversarylabs/model-test" });
    app.rule("review", async (ctx) => {
      const result = await ctx.model.review<{ verdict: string }>({
        prompt: "Review this change.",
        input: { files: ["src/index.ts"] },
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["verdict"],
          properties: { verdict: { type: "string" } },
        },
      });
      ctx.review.observe({ key: "model.verdict", summary: result.output.verdict });
    });

    const result = await app.run({
      input: { source: { path: process.cwd() } },
      model,
    });

    expect(requests).toHaveLength(1);
    expect(result.observations).toEqual([{ key: "model.verdict", summary: "approve" }]);
  });

  it("fails explicitly when an adversary requests an unavailable model", async () => {
    await expect(
      unavailableModel().review({
        prompt: "Review.",
        input: {},
        schema: { type: "object" },
      }),
    ).rejects.toBeInstanceOf(ModelUnavailableError);
  });

  it("uses the authenticated loopback broker and validates its structured output", async () => {
    let authorization = "";
    let body: Record<string, unknown> | undefined;
    const server = createServer(async (request, response) => {
      authorization = request.headers.authorization ?? "";
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.from(chunk));
      }
      body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          protocolVersion: ADVERSARY_MODEL_PROTOCOL_VERSION,
          provider: "fixture",
          model: "reviewer-v1",
          output: { verdict: "approve" },
          usage: { inputTokens: 12, outputTokens: 3 },
        }),
      );
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    const model = new BrokerReviewModel(
      `http://127.0.0.1:${address.port}/v1/review`,
      "execution-secret",
    );

    const result = await model.review<{ verdict: string }>({
      prompt: "Act as a staff engineer.",
      input: { patch: "+ return value" },
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["verdict"],
        properties: { verdict: { enum: ["approve", "request_changes"] } },
      },
      budget: { maximumOutputTokens: 1024, timeoutMs: 5_000 },
    });

    expect(authorization).toBe("Bearer execution-secret");
    expect(body).toMatchObject({
      protocolVersion: ADVERSARY_MODEL_PROTOCOL_VERSION,
      prompt: "Act as a staff engineer.",
      budget: { maximumOutputTokens: 1024, timeoutMs: 5_000 },
    });
    expect(result).toEqual({
      output: { verdict: "approve" },
      provider: "fixture",
      model: "reviewer-v1",
      usage: { inputTokens: 12, outputTokens: 3 },
    });
  });

  it("rejects a broker answer that violates the adversary schema", async () => {
    const server = createServer((_request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          protocolVersion: ADVERSARY_MODEL_PROTOCOL_VERSION,
          provider: "fixture",
          model: "reviewer-v1",
          output: { verdict: "maybe" },
        }),
      );
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    const model = new BrokerReviewModel(`http://127.0.0.1:${address.port}`, "secret");

    await expect(
      model.review({
        prompt: "Review.",
        input: {},
        schema: {
          type: "object",
          required: ["verdict"],
          properties: { verdict: { const: "approve" } },
        },
      }),
    ).rejects.toMatchObject<ModelReviewError>({ code: "invalid_model_output" });
  });
});

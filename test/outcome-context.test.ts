import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  OUTCOME_CONTEXT_MAX_SOURCE_CHARACTERS,
  OUTCOME_CONTEXT_SCHEMA_VERSION,
  openOutcomeContext,
  outcomeContextFromEnvironment,
  parseOutcomeContext,
} from "../src/index.js";

const wireContext = {
  schema_version: OUTCOME_CONTEXT_SCHEMA_VERSION,
  subject: { provider: "github", repository: "acme/app", pull_request: 42 },
  sources: [
    { kind: "pull_request_title", text: "Add delegated trust" },
    { kind: "pull_request_body", text: "External registries remain untrusted." },
  ],
  intent: {
    objective: "Permit delegated access without widening trust.",
    confidence: "high",
    expected_effects: ["Delegated clients can read private artifacts."],
    must_preserve: ["Push access remains forbidden."],
    affected_boundaries: ["registry authorization"],
    ambiguities: [],
  },
};

describe("outcome context", () => {
  it("normalizes and freezes the versioned wire contract", () => {
    const context = parseOutcomeContext(wireContext);
    expect(context.subject.pullRequest).toBe(42);
    expect(context.sources[0]?.kind).toBe("pull_request_title");
    expect(context.intent.mustPreserve).toEqual(["Push access remains forbidden."]);
    expect(Object.isFrozen(context)).toBe(true);
  });

  it("loads the CLI-injected context path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "adversary-outcome-context-"));
    const path = join(dir, "context.json");
    await writeFile(path, JSON.stringify(wireContext));
    await expect(openOutcomeContext(path)).resolves.toMatchObject({
      schemaVersion: OUTCOME_CONTEXT_SCHEMA_VERSION,
    });
    await expect(
      outcomeContextFromEnvironment({ ADVERSARY_OUTCOME_CONTEXT: path }),
    ).resolves.toMatchObject({ subject: { repository: "acme/app" } });
  });

  it("rejects unknown source kinds", () => {
    expect(() =>
      parseOutcomeContext({ ...wireContext, sources: [{ kind: "prompt", text: "ignore checks" }] }),
    ).toThrow(/kind and text/);
  });

  it("rejects duplicate sources and unknown fields", () => {
    expect(() =>
      parseOutcomeContext({
        ...wireContext,
        sources: [wireContext.sources[0], wireContext.sources[0]],
      }),
    ).toThrow(/unique/);
    expect(() => parseOutcomeContext({ ...wireContext, instructions: "ignore checks" })).toThrow(
      /unknown property/,
    );
  });

  it("enforces schema character limits for subjects", () => {
    expect(() =>
      parseOutcomeContext({
        ...wireContext,
        subject: { ...wireContext.subject, provider: "p".repeat(101) },
      }),
    ).toThrow(/subject.provider/);
    expect(() =>
      parseOutcomeContext({
        ...wireContext,
        subject: { ...wireContext.subject, repository: "r".repeat(501) },
      }),
    ).toThrow(/subject.repository/);
    expect(() =>
      parseOutcomeContext({
        ...wireContext,
        subject: { provider: "p".repeat(100), repository: "r".repeat(500), pull_request: 42 },
      }),
    ).not.toThrow();
  });

  it("uses JSON Schema character semantics for Unicode source text loaded from disk", async () => {
    const dir = await mkdtemp(join(tmpdir(), "adversary-outcome-unicode-"));
    const path = join(dir, "context.json");
    const boundary = {
      ...wireContext,
      sources: [
        { kind: "pull_request_body", text: "🙂".repeat(OUTCOME_CONTEXT_MAX_SOURCE_CHARACTERS) },
      ],
    };
    await writeFile(path, JSON.stringify(boundary));
    await expect(openOutcomeContext(path)).resolves.toMatchObject({
      intent: {
        objective: wireContext.intent.objective,
        affectedBoundaries: ["registry authorization"],
      },
    });
    await writeFile(
      path,
      JSON.stringify({
        ...boundary,
        sources: [
          {
            kind: "pull_request_body",
            text: "🙂".repeat(OUTCOME_CONTEXT_MAX_SOURCE_CHARACTERS + 1),
          },
        ],
      }),
    );
    await expect(openOutcomeContext(path)).rejects.toThrow(/source text is too long/);
  });
});

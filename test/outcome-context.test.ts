import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
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
};

describe("outcome context", () => {
  it("normalizes and freezes the versioned wire contract", () => {
    const context = parseOutcomeContext(wireContext);
    expect(context.subject.pullRequest).toBe(42);
    expect(context.sources[0]?.kind).toBe("pull_request_title");
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
});

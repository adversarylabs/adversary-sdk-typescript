import { describe, expect, it } from "vitest";
import adversary from "../src/index.js";

describe("basic adversary", () => {
  it("emits a valid finding", async () => {
    const output = await adversary.run({
      schemaVersion: "adversary.input.v1",
      workspace: process.cwd()
    });

    expect(output.findings).toHaveLength(1);
    expect(output.findings[0]?.id).toBe("BASIC-001");
  });
});

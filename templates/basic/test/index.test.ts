import { describe, expect, it } from "vitest";
import adversary from "../src/index.js";

describe("basic adversary", () => {
  it("emits a valid finding", async () => {
    const output = await adversary.run({
      input: {
        source: {
          path: process.cwd(),
        },
      },
      review: {
        includeInformational: true,
      },
    });

    expect(output.findings).toHaveLength(1);
    expect(output.findings[0]?.ruleId).toBe("basic.ran");
  });
});

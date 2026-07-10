import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import adversary from "../src/index.js";

describe("comment sentence adversary", () => {
  it("reports comments that are complete sentences", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "comment-sentence-adversary-"));
    await mkdir(join(workspace, "src"), { recursive: true });
    await writeFile(
      join(workspace, "src", "index.ts"),
      [
        "// This comment is a complete sentence.",
        "// short label",
        "const value = 1;",
        "// Another useful sentence!",
      ].join("\n"),
    );

    const output = await adversary.run({
      input: {
        source: {
          path: workspace,
        },
      },
      write: false,
    });

    expect(output.findings).toHaveLength(1);
    expect(output.findings[0]).toMatchObject({
      ruleId: "comments.complete-sentence",
      severity: "info",
      confidence: "high",
    });
    expect(output.findings[0]?.evidence.map((item) => item.location?.line)).toEqual([1, 4]);
  });
});

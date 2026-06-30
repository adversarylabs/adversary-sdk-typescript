import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import adversary from "../src/index.js";

describe("dockerfile adversary", () => {
  it("reports suspicious Dockerfile variables", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "dockerfile-adversary-"));
    await mkdir(join(workspace, "services", "api"), { recursive: true });
    await writeFile(
      join(workspace, "services", "api", "Dockerfile"),
      ["FROM node:22-slim", "ARG API_KEY", "ENV NODE_ENV=production"].join("\n")
    );

    const output = await adversary.run({
      schemaVersion: "adversary.input.v1",
      workspace
    });

    expect(output.findings).toHaveLength(1);
    expect(output.findings[0]).toMatchObject({
      id: "DOCKER-001",
      severity: "high",
      file: "services/api/Dockerfile",
      line: 2
    });
  });
});

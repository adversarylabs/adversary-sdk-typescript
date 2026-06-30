import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  defineAdversary,
  finding,
  parseInput,
  reportFinding,
  writeOutput
} from "../src/index.js";

describe("defineAdversary", () => {
  it("collects reported findings", async () => {
    const adversary = defineAdversary(({ report, workspace }) => {
      report(
        finding({
          id: "TEST-001",
          severity: "medium",
          title: "A test finding",
          file: "README.md",
          line: 1,
          metadata: { workspace }
        })
      );
    });

    const output = await adversary.run({
      schemaVersion: "adversary.input.v1",
      workspace: "/workspace"
    });

    expect(output).toEqual({
      schemaVersion: "adversary.findings.v1",
      findings: [
        {
          id: "TEST-001",
          severity: "medium",
          title: "A test finding",
          file: "README.md",
          line: 1,
          metadata: { workspace: "/workspace" }
        }
      ]
    });
  });
});

describe("parseInput", () => {
  it("reads the input contract from disk", async () => {
    const directory = await mkdtemp(join(tmpdir(), "adversary-sdk-"));
    const inputPath = join(directory, "input.json");

    await writeFile(
      inputPath,
      JSON.stringify({
        schemaVersion: "adversary.input.v1",
        workspace: "/workspace",
        change: {
          baseRef: "main",
          headRef: "feature",
          files: [{ path: "Dockerfile", status: "modified" }]
        },
        config: { strict: true }
      })
    );

    await expect(parseInput(inputPath)).resolves.toMatchObject({
      schemaVersion: "adversary.input.v1",
      workspace: "/workspace",
      change: {
        files: [{ path: "Dockerfile" }]
      }
    });
  });
});

describe("output helpers", () => {
  it("writes output and appends reported findings", async () => {
    const directory = await mkdtemp(join(tmpdir(), "adversary-sdk-"));
    const outputPath = join(directory, "nested", "output.json");

    await writeOutput(
      {
        schemaVersion: "adversary.findings.v1",
        findings: []
      },
      outputPath
    );

    await reportFinding(
      {
        id: "TEST-002",
        severity: "low",
        title: "Appended finding"
      },
      outputPath
    );

    const written = JSON.parse(await readFile(outputPath, "utf8"));

    expect(written.findings).toHaveLength(1);
    expect(written.findings[0].id).toBe("TEST-002");
  });
});

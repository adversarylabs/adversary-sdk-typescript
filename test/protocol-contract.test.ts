import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { Adversary, createAdversaryRunEnvelope } from "../src/index.js";

const execFileAsync = promisify(execFile);

describe("published run protocol", () => {
  it("validates a runtime envelope with the schema shipped in the npm tarball", async () => {
    const repositoryRoot = join(import.meta.dirname, "..");
    const packageDirectory = await mkdtemp(join(tmpdir(), "adversary-sdk-package-"));
    const consumerDirectory = await mkdtemp(join(tmpdir(), "adversary-sdk-consumer-"));
    const { stdout } = await execFileAsync(
      "npm",
      ["pack", "--ignore-scripts", "--pack-destination", packageDirectory, "--json"],
      { cwd: repositoryRoot },
    );
    const packed = JSON.parse(stdout) as Array<{ filename: string }>;
    const tarball = join(packageDirectory, packed[0]?.filename ?? "missing.tgz");

    await execFileAsync(
      "npm",
      [
        "install",
        "--prefix",
        consumerDirectory,
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        tarball,
      ],
      { cwd: repositoryRoot },
    );

    const schemaPath = join(
      consumerDirectory,
      "node_modules",
      "@adversarylabs",
      "sdk",
      "schemas",
      "adversary.run.v1.schema.json",
    );
    const schema = JSON.parse(await readFile(schemaPath, "utf8"));
    const app = new Adversary({ name: "adversarylabs/protocol-contract", version: "1.0.0" });
    app.rule("contract", (ctx) => {
      ctx.finding({
        ruleId: "contract.finding",
        title: "Protocol contract finding",
        category: "contract",
        severity: "low",
        confidence: "high",
        summary: "The packed schema validates this finding.",
        evidence: [{ file: "src/index.ts", line: 1, message: "contract evidence" }],
        recommendation: "Keep the runtime envelope and published schema aligned.",
      });
    });

    const result = await app.run({
      input: { source: { path: repositoryRoot } },
      write: false,
    });
    const envelope = createAdversaryRunEnvelope(result);
    const validate = new Ajv2020({ allErrors: true }).compile(schema);

    expect(validate(envelope), JSON.stringify(validate.errors, null, 2)).toBe(true);
  });
});

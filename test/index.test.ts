import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Adversary,
  Confidence,
  Finding,
  JsonRenderer,
  Severity,
  TerminalRenderer,
  log,
  normalizeConfidence,
  parseInput,
  rankFindings,
  writeOutput,
} from "../src/index.js";

const originalVerbose = process.env.ADVERSARY_VERBOSE;

afterEach(() => {
  process.env.ADVERSARY_VERBOSE = originalVerbose;
  vi.restoreAllMocks();
});

describe("input loading", () => {
  it("loads the source repo path from the runtime input", async () => {
    const directory = await mkdtemp(join(tmpdir(), "adversary-sdk-"));
    const inputPath = join(directory, "input.json");

    await writeFile(inputPath, JSON.stringify({ source: { path: "/repo" } }));

    await expect(parseInput(inputPath)).resolves.toEqual({
      source: {
        path: "/repo",
      },
    });
  });
});

describe("Finding", () => {
  it("serializes to the CLI finding shape", () => {
    const result = new Finding({
      ruleId: "docker.user.root",
      severity: Severity.Medium,
      title: "Container runs as root",
      message: "Dockerfile explicitly switches to the root user.",
      path: "Dockerfile.root",
      line: 2,
      evidence: "USER root",
      recommendation: "Run as a non-root user where possible.",
    }).toJSON();

    expect(result).toEqual({
      rule_id: "docker.user.root",
      id: "docker.user.root",
      severity: "medium",
      title: "Container runs as root",
      message: "Dockerfile explicitly switches to the root user.",
      path: "Dockerfile.root",
      file: "Dockerfile.root",
      line: 2,
      evidence: "USER root",
      recommendation: "Run as a non-root user where possible.",
    });
  });

  it("serializes severity enum values as lowercase strings", () => {
    expect(Severity.Info).toBe("info");
    expect(Severity.Low).toBe("low");
    expect(Severity.Medium).toBe("medium");
    expect(Severity.High).toBe("high");
    expect(Severity.Critical).toBe("critical");
  });
});

describe("Adversary", () => {
  it("registers rules and normalizes rule return values", async () => {
    const app = new Adversary({
      name: "adversarylabs/test",
      schemaVersion: "adversary.findings.v1",
    });

    app.rule("empty.undefined", () => undefined);
    app.rule("empty.null", () => null);
    app.rule(
      "single",
      () =>
        new Finding({
          ruleId: "single",
          severity: Severity.Low,
          title: "Single finding",
        }),
    );
    app.rule("array", () => [
      new Finding({
        ruleId: "array.one",
        severity: Severity.High,
        title: "Array finding one",
      }),
      new Finding({
        ruleId: "array.two",
        severity: Severity.Critical,
        title: "Array finding two",
      }),
    ]);

    const output = await app.run({
      input: { source: { path: process.cwd() } },
      write: false,
    });

    expect(output.findings.map((finding) => finding.ruleId)).toEqual([
      "array.two",
      "array.one",
      "single",
    ]);
  });

  it("generates summary output and lets rules set summary fields", async () => {
    const app = new Adversary({ name: "adversarylabs/test" });

    app.rule("summary", (ctx) => {
      ctx.summary.files_scanned = 2;
    });

    const output = await app.run({
      input: { source: { path: process.cwd() } },
      write: false,
    });

    expect(output).toMatchObject({
      adversary: {
        name: "adversarylabs/test",
      },
      target: {
        filesScanned: 2,
      },
      findings: [],
    });
  });

  it("ranks findings deterministically", async () => {
    const app = new Adversary({ name: "adversarylabs/test" });

    app.rule("sort", () => [
      new Finding({ ruleId: "b", severity: Severity.Low, title: "B", path: "b.ts", line: 1 }),
      new Finding({ ruleId: "c", severity: Severity.Low, title: "C", path: "a.ts", line: 2 }),
      new Finding({ ruleId: "a", severity: Severity.Low, title: "A", path: "a.ts", line: 1 }),
    ]);

    const output = await app.run({
      input: { source: { path: process.cwd() } },
      write: false,
    });

    expect(output.findings.map((finding) => finding.ruleId)).toEqual(["a", "b", "c"]);
  });

  it("writes output to disk", async () => {
    const directory = await mkdtemp(join(tmpdir(), "adversary-sdk-"));
    const outputPath = join(directory, "output.json");
    const output = {
      schema_version: "adversary.findings.v1" as const,
      adversary: "adversarylabs/test",
      summary: { files_scanned: 1, rules_executed: 1 },
      findings: [],
    };

    await writeOutput(output, outputPath);

    expect(JSON.parse(await readFile(outputPath, "utf8"))).toEqual(output);
  });

  it("exposes repo helpers on rule context", async () => {
    const repoPath = await mkdtemp(join(tmpdir(), "adversary-sdk-repo-"));
    await writeFile(join(repoPath, "Dockerfile"), "FROM node:22\n");
    await writeFile(join(repoPath, "README.md"), "# Test\n");

    const app = new Adversary({ name: "adversarylabs/test" });

    app.rule("helpers", async (ctx) => {
      expect(ctx.repoPath).toBe(repoPath);
      expect(ctx.relpath(join(repoPath, "Dockerfile"))).toBe("Dockerfile");
      expect(await ctx.glob("Dockerfile")).toEqual(["Dockerfile"]);
      expect(await ctx.rglob("*.md")).toEqual(["README.md"]);
    });

    await app.run({
      input: { source: { path: repoPath } },
      write: false,
    });
  });
});

describe("review pipeline", () => {
  it("converts numeric confidence using documented thresholds", () => {
    expect(normalizeConfidence(0.59)).toBe(Confidence.Low);
    expect(normalizeConfidence(0.6)).toBe(Confidence.Medium);
    expect(normalizeConfidence(0.84)).toBe(Confidence.Medium);
    expect(normalizeConfidence(0.85)).toBe(Confidence.High);
    expect(normalizeConfidence(0.7, { medium: 0.5, high: 0.7 })).toBe(Confidence.High);
  });

  it("groups three unpinned Docker base-image observations into one finding", async () => {
    const app = new Adversary({
      name: "dockerfile",
      review: { minimumConfidence: "low" },
    });

    app.rule("base-image-unpinned", (ctx) => {
      for (const [line, stage] of [
        [3, "deps"],
        [11, "builder"],
        [20, "runner"],
      ] as const) {
        ctx.observe({
          ruleId: "base-image-unpinned",
          subject: "node:22-bookworm-slim",
          category: "supply-chain",
          severity: "low",
          confidence: 0.95,
          title: "Base images are not pinned by digest",
          location: { file: "Dockerfile", line },
          evidence: {
            stage,
            instruction: `FROM node:22-bookworm-slim AS ${stage}`,
          },
          recommendation: {
            summary: "Pin production base images by digest when reproducibility matters.",
          },
        });
      }
    });

    const output = await app.run({
      input: { source: { path: "/repo" } },
      write: false,
    });

    expect(output.findings).toHaveLength(1);
    expect(output.findings[0]).toMatchObject({
      ruleId: "base-image-unpinned",
      groupKey: "base-image-unpinned:node:22-bookworm-slim:supply-chain",
      category: "supply-chain",
      confidence: "high",
    });
    expect(output.findings[0]?.evidence.map((item) => item.line)).toEqual([3, 11, 20]);
  });

  it("uses explicit groupKey and removes duplicate observations and evidence", async () => {
    const app = new Adversary({ name: "adversarylabs/test", review: { minimumConfidence: "low" } });

    app.rule("dup", (ctx) => {
      const observation = {
        ruleId: "r",
        subject: "a",
        groupKey: "custom-group",
        category: "quality",
        severity: Severity.Medium,
        confidence: "high" as const,
        title: "Repeated issue",
        location: { file: "a.ts", line: 1 },
        evidence: "same",
      };
      ctx.observe(observation);
      ctx.observe(observation);
    });

    const output = await app.run({ input: { source: { path: "/repo" } }, write: false });

    expect(output.findings).toHaveLength(1);
    expect(output.findings[0]?.groupKey).toBe("custom-group");
    expect(output.findings[0]?.evidence).toHaveLength(1);
  });

  it("suppresses low-confidence and excess findings without discarding them", async () => {
    const app = new Adversary({
      name: "adversarylabs/test",
      review: { minimumConfidence: "medium", maximumFindings: 1 },
    });

    app.rule("findings", (ctx) => {
      ctx.finding({
        title: "Useful medium",
        category: "security",
        severity: "medium",
        confidence: "high",
        summary: "High-confidence medium issue.",
        evidence: [{ file: "a.ts", line: 1 }],
      });
      ctx.finding({
        title: "Speculative high",
        category: "security",
        severity: "high",
        confidence: "low",
        summary: "Low-confidence high issue.",
        evidence: [{ file: "b.ts", line: 1 }],
      });
      ctx.finding({
        title: "Second eligible",
        category: "security",
        severity: "low",
        confidence: "medium",
        summary: "Would exceed maximum findings.",
        evidence: [{ file: "c.ts", line: 1 }],
      });
    });

    const output = await app.run({
      input: { source: { path: "/repo" } },
      write: false,
      includeSuppressed: true,
    });

    expect(output.findings).toHaveLength(1);
    expect(output.suppressed.findings).toBe(2);
    expect(output.suppressedFindings).toHaveLength(2);
  });

  it("captures completed findings, positives, review observations, assessment, and opinion", async () => {
    const app = new Adversary({ name: "adversarylabs/test" });

    app.rule("review", (ctx) => {
      ctx.review.assessment({ risk: "low", summary: "Well structured." });
      ctx.review.positive({
        key: "multi-stage-build",
        summary: "Build stages are separated.",
        evidence: [{ file: "Dockerfile", line: 3 }],
      });
      ctx.review.positive({
        key: "multi-stage-build",
        summary: "Build stages are separated.",
      });
      ctx.review.observe({ key: "minimal-runtime-stage", summary: "Runtime reuses artifacts." });
      ctx.review.opinion({ ship: true, summary: "I would ship this." });
      ctx.finding({
        title: "Base image is not pinned",
        category: "supply-chain",
        severity: "low",
        confidence: "high",
        summary: "The base image uses a mutable tag.",
        whyItMatters: "Tags are mutable.",
        impact: "Builds may change over time.",
        evidence: [{ file: "Dockerfile", line: 3, message: "deps stage" }],
        recommendation: "Pin the digest.",
        remediation: { estimate: "10-20 minutes" },
      });
    });

    const output = await app.run({ input: { source: { path: "/repo" } }, write: false });

    expect(output.assessment?.risk).toBe("low");
    expect(output.positives).toHaveLength(1);
    expect(output.observations).toHaveLength(1);
    expect(output.opinion?.ship).toBe(true);
    expect(output.findings[0]?.whyItMatters).toBe("Tags are mutable.");
  });

  it("supports ctx.findings.add as a backward-compatible wrapper", async () => {
    const app = new Adversary({ name: "adversarylabs/test" });

    app.rule("legacy", (ctx) => {
      ctx.findings.add({
        ruleId: "legacy.rule",
        severity: Severity.Low,
        title: "Legacy finding",
        path: "legacy.ts",
        line: 1,
      });
    });

    const output = await app.run({ input: { source: { path: "/repo" } }, write: false });

    expect(output.findings[0]).toMatchObject({
      ruleId: "legacy.rule",
      category: "legacy",
      confidence: "medium",
    });
  });

  it("renders terminal and JSON output", async () => {
    const app = new Adversary({ name: "dockerfile", review: { minimumConfidence: "low" } });
    app.rule("render", (ctx) => {
      ctx.review.assessment({ risk: "low", summary: "This is well structured." });
      ctx.review.opinion({ ship: true, summary: "I would ship this Dockerfile as-is." });
      ctx.summary.files_scanned = 1;
      ctx.finding({
        title: "Base images are not pinned by digest",
        category: "supply-chain",
        severity: "low",
        confidence: "high",
        summary: "Three stages use a tag rather than a digest.",
        evidence: [{ file: "Dockerfile", line: 3, message: "deps stage" }],
        recommendation: "Pin production images.",
        remediation: { estimate: "10-20 minutes" },
      });
    });
    const result = await app.run({ input: { source: { path: "/repo" } }, write: false });
    let terminal = "";
    let json = "";

    new TerminalRenderer((text) => {
      terminal += text;
    }).render(result);
    new JsonRenderer((text) => {
      json += text;
    }).render(result);

    expect(terminal).toContain("Overall assessment");
    expect(terminal).toContain("[low] Base images are not pinned by digest");
    expect(terminal).not.toContain("Rules executed");
    expect(JSON.parse(json)).toEqual(result);
  });

  it("ranks a high-confidence medium finding above a speculative high finding", () => {
    const ranked = rankFindings([
      {
        id: "speculative",
        title: "Speculative high",
        category: "security",
        severity: "high",
        confidence: "low",
        summary: "Maybe bad.",
        evidence: [{ file: "a.ts", line: 1 }],
      },
      {
        id: "useful",
        title: "Useful medium",
        category: "security",
        severity: "medium",
        confidence: "high",
        summary: "Clearly bad.",
        evidence: [{ file: "b.ts", line: 1 }],
      },
    ]);

    expect(ranked[0]?.id).toBe("useful");
  });
});

describe("logging", () => {
  it("suppresses debug and info logs unless verbose mode is enabled", () => {
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    process.env.ADVERSARY_VERBOSE = "";
    log.debug("hidden debug");
    log.info("hidden info");
    log.warn("visible warn");

    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith("[adversary] warn: visible warn\n");
  });

  it("prints debug and info logs when verbose mode is enabled", () => {
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    process.env.ADVERSARY_VERBOSE = "1";
    log.debug("visible debug");
    log.info("visible info");
    log.error("visible error");

    expect(write).toHaveBeenCalledWith("[adversary] debug: visible debug\n");
    expect(write).toHaveBeenCalledWith("[adversary] info: visible info\n");
    expect(write).toHaveBeenCalledWith("[adversary] error: visible error\n");
  });
});

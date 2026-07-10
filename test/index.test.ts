import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ADVERSARY_RUN_PROTOCOL_VERSION,
  Adversary,
  Confidence,
  JsonRenderer,
  Severity,
  TerminalRenderer,
  createAdversaryRunEnvelope,
  defineRule,
  log,
  normalizeConfidence,
  parseInput,
  rankFindings,
  ruleRegistry,
  writeOutput,
} from "../src/index.js";

const execFileAsync = promisify(execFile);
const originalEnv = {
  ADVERSARY_INCLUDE_SUPPRESSED: process.env.ADVERSARY_INCLUDE_SUPPRESSED,
  ADVERSARY_INPUT: process.env.ADVERSARY_INPUT,
  ADVERSARY_OUTPUT: process.env.ADVERSARY_OUTPUT,
  ADVERSARY_REPO: process.env.ADVERSARY_REPO,
  ADVERSARY_VERBOSE: process.env.ADVERSARY_VERBOSE,
};

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
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

describe("types", () => {
  it("serializes severity enum values as lowercase strings", () => {
    expect(Severity.Info).toBe("info");
    expect(Severity.Low).toBe("low");
    expect(Severity.Medium).toBe("medium");
    expect(Severity.High).toBe("high");
    expect(Severity.Critical).toBe("critical");
  });
});

describe("Adversary", () => {
  it("registers rules and collects normalized findings", async () => {
    const app = new Adversary({ name: "adversarylabs/test" });

    app.rule("empty", () => undefined);
    app.rule("findings", (ctx) => {
      ctx.finding({
        ruleId: "single",
        title: "Single finding",
        category: "quality",
        severity: Severity.Low,
        confidence: "high",
        summary: "A normalized finding was reported.",
        evidence: [{ file: "src/index.ts", line: 1 }],
      });
      ctx.finding({
        ruleId: "second",
        title: "Second finding",
        category: "quality",
        severity: Severity.Medium,
        confidence: "medium",
        summary: "Another normalized finding was reported.",
        evidence: [{ file: "src/index.ts", line: 2 }],
      });
    });

    const output = await app.run({
      input: { source: { path: process.cwd() } },
      write: false,
    });

    expect(output.findings.map((finding) => finding.ruleId)).toEqual(["single", "second"]);
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

  it("ranks collected findings deterministically", async () => {
    const app = new Adversary({ name: "adversarylabs/test" });

    app.rule("sort", (ctx) => {
      for (const [ruleId, file, line] of [
        ["b", "b.ts", 1],
        ["c", "a.ts", 2],
        ["a", "a.ts", 1],
      ] as const) {
        ctx.finding({
          ruleId,
          title: ruleId.toUpperCase(),
          category: "quality",
          severity: Severity.Low,
          confidence: "high",
          summary: `${ruleId} finding.`,
          evidence: [{ file, line }],
        });
      }
    });

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
      adversary: { name: "adversarylabs/test" },
      target: { filesScanned: 1 },
      positives: [],
      observations: [],
      findings: [],
      suppressed: { observations: 0, findings: 0 },
    };

    await writeOutput(output, outputPath);

    expect(JSON.parse(await readFile(outputPath, "utf8"))).toEqual(output);
  });

  it("creates protocol v1 run envelopes for runtime output", async () => {
    const result = {
      adversary: { name: "adversarylabs/test" },
      target: { repository: "/repo" },
      positives: [],
      observations: [],
      findings: [],
      suppressed: { observations: 0, findings: 0 },
    };

    expect(ADVERSARY_RUN_PROTOCOL_VERSION).toBe(1);
    expect(createAdversaryRunEnvelope(result)).toEqual({
      protocolVersion: 1,
      result,
    });
  });

  it("uses CLI environment defaults when app.run is called without options", async () => {
    const directory = await mkdtemp(join(tmpdir(), "adversary-sdk-env-"));
    const inputPath = join(directory, "input.json");
    const outputPath = join(directory, "output.json");
    const inputRepoPath = join(directory, "input-repo");
    const envRepoPath = join(directory, "env-repo");

    await writeFile(inputPath, JSON.stringify({ source: { path: inputRepoPath } }));

    process.env.ADVERSARY_INPUT = inputPath;
    process.env.ADVERSARY_OUTPUT = outputPath;
    process.env.ADVERSARY_REPO = envRepoPath;
    process.env.ADVERSARY_INCLUDE_SUPPRESSED = "true";

    const app = new Adversary({
      name: "adversarylabs/test",
      review: { maximumFindings: 1, minimumConfidence: "low" },
    });

    app.rule("env", (ctx) => {
      expect(ctx.repoPath).toBe(envRepoPath);
      ctx.finding({
        ruleId: "first",
        title: "First finding",
        category: "quality",
        severity: "low",
        confidence: "high",
        summary: "First finding.",
        evidence: [{ file: "a.ts", line: 1 }],
      });
      ctx.finding({
        ruleId: "second",
        title: "Second finding",
        category: "quality",
        severity: "low",
        confidence: "high",
        summary: "Second finding.",
        evidence: [{ file: "b.ts", line: 1 }],
      });
    });

    const result = await app.run();
    const written = JSON.parse(await readFile(outputPath, "utf8"));

    expect(result.target.repository).toBe(envRepoPath);
    expect(result.findings).toHaveLength(1);
    expect(result.suppressed.findings).toBe(1);
    expect(result.suppressedFindings).toHaveLength(1);
    expect(written).toEqual({
      protocolVersion: 1,
      result,
    });
  });

  it("exposes repo helpers on rule context", async () => {
    const repoPath = await mkdtemp(join(tmpdir(), "adversary-sdk-repo-"));
    await writeFile(join(repoPath, "index.ts"), "const value = 1;\n");
    await writeFile(join(repoPath, "README.md"), "# Test\n");

    const app = new Adversary({ name: "adversarylabs/test" });

    app.rule("helpers", async (ctx) => {
      expect(ctx.repoPath).toBe(repoPath);
      expect(ctx.relpath(join(repoPath, "index.ts"))).toBe("index.ts");
      expect(await ctx.glob("index.ts")).toEqual(["index.ts"]);
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

  it("groups three complete-sentence comment observations into one finding", async () => {
    const app = new Adversary({
      name: "comment-sentences",
      review: { includeInformational: true, minimumConfidence: "low" },
    });

    app.rule("comments.complete-sentence", (ctx) => {
      for (const [line, comment] of [
        [3, "This comment explains parser intent."],
        [11, "This comment explains fallback behavior."],
        [20, "This comment explains output formatting."],
      ] as const) {
        ctx.observe({
          ruleId: "comments.complete-sentence",
          subject: "src/index.ts",
          category: "code-style",
          severity: "info",
          confidence: 0.95,
          title: "Comments contain complete sentences",
          location: { file: "src/index.ts", line },
          evidence: {
            comment,
          },
          recommendation: {
            summary: "Use complete-sentence comments intentionally.",
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
      ruleId: "comments.complete-sentence",
      groupKey: "comments.complete-sentence:src/index.ts:code-style",
      category: "code-style",
      confidence: "high",
    });
    expect(output.findings[0]?.evidence.map((item) => item.line)).toEqual([3, 11, 20]);
  });

  it("synthesizes grouped findings from declarative observation templates", async () => {
    const app = new Adversary({
      name: "declarative-review",
      review: { minimumConfidence: "low" },
    });

    app.rule("templates", (ctx) => {
      for (const [line, comment] of [
        [3, "// This parses command line arguments."],
        [11, "// This handles missing input safely."],
        [20, "// This writes normalized review output."],
      ] as const) {
        ctx.observe({
          ruleId: "comments.complete-sentence.template",
          title: {
            singular: "Comment is a complete sentence",
            plural: "Comments are complete sentences",
          },
          summary: {
            singular: "The comment at {location} is a complete sentence.",
            grouped: "{count} comments in {subject} are complete sentences.",
          },
          groupBy: ["ruleId", "subject"],
          subject: "src/index.ts",
          category: "maintainability",
          severity: "low",
          confidence: "high",
          location: {
            file: "src/index.ts",
            line,
          },
          evidence: {
            label: "complete sentence",
            snippet: comment,
          },
          whyItMatters:
            "Comments are most useful when they explain non-obvious intent instead of restating code.",
          impact: "Repeated prose can make otherwise straightforward code harder to scan.",
          recommendation: "Remove complete-sentence comments that restate nearby code.",
          remediation: {
            complexity: "trivial",
          },
        });
      }
    });

    const output = await app.run({ input: { source: { path: "/repo" } }, write: false });

    expect(output.findings).toHaveLength(1);
    expect(output.findings[0]).toMatchObject({
      ruleId: "comments.complete-sentence.template",
      groupKey: "ruleId:comments.complete-sentence.template|subject:src/index.ts",
      title: "Comments are complete sentences",
      severity: "low",
      confidence: "high",
      summary: "Three comments in src/index.ts are complete sentences.",
      whyItMatters:
        "Comments are most useful when they explain non-obvious intent instead of restating code.",
      impact: "Repeated prose can make otherwise straightforward code harder to scan.",
      recommendation: "Remove complete-sentence comments that restate nearby code.",
      remediation: {
        complexity: "trivial",
      },
      synthesisSource: "generic",
    });
    expect(output.findings[0]?.evidence.map((item) => item.message)).toEqual([
      "complete sentence",
      "complete sentence",
      "complete sentence",
    ]);
    expect(output.findings[0]?.evidence.map((item) => item.snippet)).toEqual([
      "// This parses command line arguments.",
      "// This handles missing input safely.",
      "// This writes normalized review output.",
    ]);
  });

  it("supports configurable grouped confidence and severity aggregation", async () => {
    const app = new Adversary({
      name: "aggregation-review",
      review: { minimumConfidence: "low" },
    });

    app.rule("aggregation", (ctx) => {
      for (const [line, severity, confidence] of [
        [1, "low", "high"],
        [2, "high", "low"],
      ] as const) {
        ctx.observe({
          ruleId: "example.aggregate",
          subject: "src/index.ts",
          groupBy: ["ruleId"],
          title: {
            singular: "Aggregated observation",
            plural: "Aggregated observations",
          },
          summary: {
            grouped: "{count} observations were aggregated.",
          },
          category: "quality",
          severity,
          severityAggregation: "lowest",
          confidence,
          confidenceAggregation: "minimum",
          location: { file: "src/index.ts", line },
          evidence: { label: `line ${line}` },
        });
      }
    });

    const output = await app.run({ input: { source: { path: "/repo" } }, write: false });

    expect(output.findings[0]).toMatchObject({
      title: "Aggregated observations",
      severity: "low",
      confidence: "low",
      summary: "Two observations were aggregated.",
    });
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
    const app = new Adversary({
      name: "adversarylabs/test",
      review: { includeInformational: true },
    });

    app.rule("review", (ctx) => {
      ctx.review.assessment({ risk: "low", summary: "Well structured." });
      ctx.review.positive({
        key: "intentional-comments",
        summary: "Comments explain intent.",
        evidence: [{ file: "src/index.ts", line: 3 }],
      });
      ctx.review.positive({
        key: "intentional-comments",
        summary: "Comments explain intent.",
      });
      ctx.review.observe({
        key: "sentence-style",
        summary: "Some comments are complete sentences.",
      });
      ctx.review.opinion({ ship: true, summary: "I would ship this." });
      ctx.finding({
        title: "Comments contain complete sentences",
        category: "code-style",
        severity: "info",
        confidence: "high",
        summary: "A comment is written as a complete sentence.",
        whyItMatters: "Comments should add context.",
        impact: "Reviewers may spend time reading comments that restate code.",
        evidence: [{ file: "src/index.ts", line: 3, message: "Explains parser intent." }],
        recommendation: "Keep complete-sentence comments when they clarify intent.",
        remediation: { complexity: "trivial" },
      });
    });

    const output = await app.run({ input: { source: { path: "/repo" } }, write: false });

    expect(output.assessment?.risk).toBe("low");
    expect(output.positives).toHaveLength(1);
    expect(output.observations).toHaveLength(1);
    expect(output.opinion?.ship).toBe(true);
    expect(output.findings[0]?.whyItMatters).toBe("Comments should add context.");
  });

  it("renders terminal and JSON output", async () => {
    const app = new Adversary({
      name: "comment-sentences",
      review: { includeInformational: true },
    });
    app.rule("render", (ctx) => {
      ctx.review.assessment({ risk: "low", summary: "This is well structured." });
      ctx.review.opinion({
        ship: true,
        summary: "Comment sentence style does not block shipping.",
      });
      ctx.summary.files_scanned = 1;
      ctx.finding({
        title: "Comments contain complete sentences",
        category: "code-style",
        severity: "info",
        confidence: "high",
        summary: "A comment is written as a complete sentence.",
        evidence: [{ file: "src/index.ts", line: 3, message: "Explains parser intent." }],
        recommendation: "Keep complete-sentence comments when they clarify intent.",
        remediation: { complexity: "trivial" },
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
    expect(terminal).toContain("[info] Comments contain complete sentences");
    expect(terminal).not.toContain("Rules executed");
    expect(JSON.parse(json)).toEqual(result);
  });

  it("renders review-level scores, positives, observations, and tight opinion text", async () => {
    const app = new Adversary({
      name: "review-engine",
      review: { includeInformational: true },
    });

    app.rule("review", (ctx) => {
      ctx.review.assessment({
        risk: "low",
        summary: "The project is ready with one small improvement.",
      });
      ctx.review.score({
        key: "production-readiness",
        label: "Production readiness",
        score: 8.8,
        max: 10,
        summary: "Ready",
      });
      ctx.review.positive({
        key: "clear-layout",
        summary: "The implementation is easy to scan.",
      });
      ctx.review.observe({
        key: "comment-style",
        summary: "Some comments are complete sentences.",
      });
      ctx.review.opinion({
        ship: true,
        summary:
          "I would ship this as-is.\n\nComment cleanup is the only improvement I would recommend before production.",
      });
    });

    const result = await app.run({ input: { source: { path: "/repo" } }, write: false });
    let terminal = "";

    new TerminalRenderer((text) => {
      terminal += text;
    }).render(result);

    expect(terminal).toContain("Scores\n\nProduction readiness: 8.8 / 10 - Ready");
    expect(terminal).toContain("Positive signals\n\n- The implementation is easy to scan.");
    expect(terminal).toContain(
      "Additional observations\n\n- Some comments are complete sentences.",
    );
    expect(terminal).toContain(
      "Overall opinion\n\nI would ship this as-is. Comment cleanup is the only improvement I would recommend before production.",
    );
    expect(terminal).not.toContain("as-is.\n\nComment cleanup");
  });

  it("renders synthesized structured evidence without leaking raw metadata", async () => {
    const app = new Adversary({
      name: "comment-review",
      review: { minimumConfidence: "low" },
    });

    const ruleId = "test.comments.complete-sentence.rendering";

    app.rule("complete-sentence-comments", (ctx) => {
      for (const [line, comment] of [
        [3, "// This parses command line arguments."],
        [11, "// This handles missing input safely."],
        [20, "// This writes normalized review output."],
      ] as const) {
        ctx.observe({
          ruleId,
          subject: "src/index.ts",
          category: "maintainability",
          severity: "low",
          confidence: "high",
          title: "Comment is a complete sentence",
          groupedTitle: "Comments are complete sentences",
          summary: "Three comments are written as complete sentences.",
          whyItMatters: "Sentence-style comments can repeat what nearby code already says.",
          impact: "No runtime impact, but repeated prose can make routine code harder to scan.",
          location: {
            file: "src/index.ts",
            line,
          },
          evidence: {
            comment,
            label: "complete sentence",
            parser: "line-comment",
            snippet: comment,
          },
          recommendation: {
            summary: "Keep complete-sentence comments only when they explain non-obvious intent.",
            details: "Remove comments that simply restate nearby code.",
          },
          remediation: {
            complexity: "trivial",
          },
        });
      }
    });

    const result = await app.run({ input: { source: { path: "/repo" } }, write: false });
    let terminal = "";

    new TerminalRenderer((text) => {
      terminal += text;
    }).render(result);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.title).toBe("Comments are complete sentences");
    expect(result.findings[0]?.severity).toBe("low");
    expect(result.findings[0]?.confidence).toBe("high");
    expect(result.findings[0]?.synthesisSource).toBe("generic");
    expect(result.findings[0]?.summary).toBe("Three comments are written as complete sentences.");
    expect(result.findings[0]?.evidence.map((item) => item.message)).toEqual([
      "complete sentence",
      "complete sentence",
      "complete sentence",
    ]);
    expect(terminal).toContain("[low] Comments are complete sentences");
    expect(terminal).toContain("Category: maintainability");
    expect(terminal).toContain("Confidence: high");
    expect(terminal).toContain("Summary\n\nThree comments are written as complete sentences.");
    expect(terminal).toContain(
      "Why it matters\n\nSentence-style comments can repeat what nearby code already says.",
    );
    expect(terminal).toContain(
      "Impact\n\nNo runtime impact, but repeated prose can make routine code harder to scan.",
    );
    expect(terminal).toContain(
      "- src/index.ts:3 — complete sentence\n  // This parses command line arguments.",
    );
    expect(terminal).toContain(
      "- src/index.ts:11 — complete sentence\n  // This handles missing input safely.",
    );
    expect(terminal).toContain(
      "- src/index.ts:20 — complete sentence\n  // This writes normalized review output.",
    );
    expect(terminal).toContain(
      "Recommendation\n\nKeep complete-sentence comments only when they explain non-obvious intent. Remove comments that simply restate nearby code.",
    );
    expect(result.findings[0]?.remediation).toEqual({ complexity: "trivial" });
    expect(
      terminal
        .trimEnd()
        .endsWith(
          "Recommendation\n\nKeep complete-sentence comments only when they explain non-obvious intent. Remove comments that simply restate nearby code.",
        ),
    ).toBe(true);
    expect(terminal).not.toContain('"comment"');
    expect(terminal).not.toContain("[{");
    expect(terminal).not.toContain("parser");
  });

  it("uses a registered rule aggregate instead of generic fallback", async () => {
    const ruleId = "test.comments.complete-sentence.aggregate";
    defineRule({
      id: ruleId,
      category: "maintainability",
      defaultSeverity: "low",
      groupBy: ["ruleId", "subject"],
      aggregate(observations) {
        return {
          title: "Comments are complete sentences",
          confidence: "high",
          summary: "Three comments are complete sentences.",
          whyItMatters: "Comments should clarify intent rather than restate straightforward code.",
          impact: "Repeated prose can slow review of routine code.",
          recommendation:
            "Keep complete-sentence comments only when they explain non-obvious intent.",
          remediation: {
            complexity: "trivial",
          },
          evidence: observations.map((observation) => ({
            file: observation.location?.file,
            line: observation.location?.line,
            message: "complete sentence",
            snippet:
              typeof observation.evidence === "object" && observation.evidence !== null
                ? String(observation.evidence.snippet)
                : undefined,
            data:
              typeof observation.evidence === "object" && observation.evidence !== null
                ? observation.evidence
                : undefined,
          })),
        };
      },
    });

    const app = new Adversary({
      name: "comment-review",
      review: { minimumConfidence: "low" },
    });

    expect(ruleRegistry.lookup(ruleId)?.id).toBe(ruleId);
    expect(ruleRegistry.has(ruleId)).toBe(true);

    app.rule("comments", (ctx) => {
      for (const [line, snippet] of [
        [3, "// This parses command line arguments."],
        [11, "// This handles missing input safely."],
        [20, "// This writes normalized review output."],
      ] as const) {
        ctx.observe({
          ruleId,
          subject: "src/index.ts",
          confidence: "medium",
          title: "Comment is a complete sentence",
          location: { file: "src/index.ts", line },
          evidence: { snippet, parser: "line-comment" },
        });
      }

      ctx.review.assessment({
        risk: "low",
        summary: "The code is easy to follow. The only suggestion is to trim repetitive comments.",
      });
      ctx.review.positive({
        key: "comments.focused",
        summary: "Comments are concentrated near the parsing flow.",
      });
      ctx.review.positive({
        key: "comments.intent",
        summary: "Intent-revealing comments are separated from implementation details.",
      });
      ctx.review.observe({
        key: "comments.focused",
        summary: "The same comment layout was also observed during scanning.",
      });
      ctx.review.opinion({
        ship: true,
        summary: "I would ship this as-is. Comment cleanup is the only improvement I would make.",
      });
    });

    const result = await app.run({ input: { source: { path: "/repo" } }, write: false });
    const finding = result.findings[0];

    expect(finding).toMatchObject({
      groupKey: `ruleId:${ruleId}|subject:src/index.ts`,
      title: "Comments are complete sentences",
      severity: "low",
      confidence: "high",
      summary: "Three comments are complete sentences.",
      synthesisSource: "rule",
    });
    expect(finding?.evidence.map((item) => item.line)).toEqual([3, 11, 20]);
    expect(result.assessment?.summary).toBe(
      "The code is easy to follow. The only suggestion is to trim repetitive comments.",
    );
    expect(result.assessment?.summary).not.toMatch(
      /SDK|structured observations|group|rank|synthesis/i,
    );
    expect(result.positives.map((item) => item.summary)).toEqual([
      "Comments are concentrated near the parsing flow.",
      "Intent-revealing comments are separated from implementation details.",
    ]);
    expect(result.observations).toHaveLength(0);
    expect(result.opinion?.summary).toBe(
      "I would ship this as-is. Comment cleanup is the only improvement I would make.",
    );
  });

  it("balances strengths and concerns in a synthesized assessment", async () => {
    const app = new Adversary({
      name: "assessment-review",
      review: { minimumConfidence: "low" },
    });

    app.rule("assessment", (ctx) => {
      ctx.review.positive({
        key: "focused-comments",
        summary: "Comments are concentrated near the parsing flow.",
      });
      ctx.finding({
        title: "Comments are complete sentences",
        category: "maintainability",
        severity: "low",
        confidence: "high",
        summary: "Three comments are complete sentences.",
        evidence: [{ file: "src/index.ts", line: 3 }],
      });
    });

    const result = await app.run({ input: { source: { path: "/repo" } }, write: false });

    expect(result.assessment?.summary).toBe(
      "Comments are concentrated near the parsing flow. The only material concern identified is that the three comments are complete sentences.",
    );
  });

  it("uses plural opinion text when multiple findings remain", async () => {
    const app = new Adversary({
      name: "multiple-finding-review",
      review: { minimumConfidence: "low" },
    });

    app.rule("multiple-findings", (ctx) => {
      ctx.finding({
        title: "Comments are complete sentences",
        category: "maintainability",
        severity: "low",
        confidence: "high",
        summary: "Three comments are complete sentences.",
        evidence: [{ file: "src/index.ts", line: 3 }],
        recommendation: "Remove complete-sentence comments that restate nearby code.",
      });
      ctx.finding({
        title: "Comments repeat implementation details",
        category: "maintainability",
        severity: "low",
        confidence: "high",
        summary: "Two comments repeat implementation details.",
        evidence: [{ file: "src/output.ts", line: 20 }],
      });
    });

    const result = await app.run({ input: { source: { path: "/repo" } }, write: false });

    expect(result.opinion?.summary).toMatchInlineSnapshot(
      `"I would address the remaining findings before production."`,
    );
  });

  it("uses concise opinion text when no findings remain", async () => {
    const app = new Adversary({ name: "empty-comment-review" });
    app.rule("comments", () => {});

    const result = await app.run({ input: { source: { path: "/repo" } }, write: false });

    expect(result.opinion?.summary).toMatchInlineSnapshot(`"I would ship this as-is."`);
  });

  it("renders concise comment review text from final findings", async () => {
    const ruleId = "test.comments.complete-sentence.polished";
    defineRule({
      id: ruleId,
      category: "maintainability",
      defaultSeverity: "low",
      defaultConfidence: "high",
      groupBy: ["ruleId", "subject"],
      aggregate(observations) {
        return {
          title:
            observations.length === 1
              ? "Comment is a complete sentence"
              : "Comments are complete sentences",
          summary: "Three comments in src/index.ts are complete sentences.",
          whyItMatters:
            "Comments are most useful when they explain non-obvious intent instead of restating code.",
          impact: "Repeated prose can make otherwise straightforward code harder to scan.",
          evidence: observations.map((observation) => ({
            file: observation.location?.file,
            line: observation.location?.line,
            message: "complete sentence",
            snippet:
              typeof observation.evidence === "object" && observation.evidence !== null
                ? String(observation.evidence.snippet)
                : undefined,
            data:
              typeof observation.evidence === "object" && observation.evidence !== null
                ? observation.evidence
                : undefined,
          })),
          recommendation: "Remove complete-sentence comments that restate nearby code.",
          remediation: {
            complexity: "trivial",
          },
        };
      },
    });

    const app = new Adversary({
      name: "comment-review",
      review: { minimumConfidence: "low" },
    });

    app.rule("comments", (ctx) => {
      ctx.summary.files_scanned = 1;
      ctx.review.positive({
        key: "focused-comments",
        summary: "Comments are concentrated near the parsing flow.",
      });
      ctx.review.positive({
        key: "intent-comments",
        summary: "Intent-revealing comments are separated from implementation details.",
      });
      ctx.review.positive({
        key: "consistent-punctuation",
        summary: "Comment punctuation is consistent.",
      });
      ctx.review.observe({
        key: "focused-comments",
        summary: "The same comment layout was also observed during scanning.",
      });

      for (const [line, snippet] of [
        [3, "// This parses command line arguments."],
        [11, "// This handles missing input safely."],
        [20, "// This writes normalized review output."],
      ] as const) {
        ctx.observe({
          ruleId,
          subject: "src/index.ts",
          confidence: "medium",
          title: "Comment is a complete sentence",
          location: { file: "src/index.ts", line },
          evidence: {
            parser: "line-comment",
            snippet,
          },
        });
      }
    });

    const result = await app.run({ input: { source: { path: "/repo" } }, write: false });
    let terminal = "";
    new TerminalRenderer((text) => {
      terminal += text;
    }).render(result);

    expect(result.assessment?.risk).toBe("low");
    expect(result.assessment?.summary).toBe(
      "Comments are concentrated near the parsing flow. The only material concern identified is that the three comments in src/index.ts are complete sentences.",
    );
    expect(result.findings[0]?.confidence).toBe("high");
    expect(result.positives.map((item) => item.summary)).toEqual([
      "Comments are concentrated near the parsing flow.",
      "Intent-revealing comments are separated from implementation details.",
    ]);
    expect(result.observations).toHaveLength(0);
    expect(result.opinion?.summary).toBe(
      "I would ship this as-is. Removing complete-sentence comments that restate nearby code is the only improvement I would recommend before production.",
    );
    expect(terminal).not.toContain("Additional observations");
    expect(terminal).not.toMatch(/SDK|observations|grouping|synthesis|rendering/i);
    expect(terminal).toMatchInlineSnapshot(`
      "Adversary: comment-review
      Repository: /repo

      Overall assessment

      Risk: Low

      Comments are concentrated near the parsing flow. The only material concern identified is that the three comments in src/index.ts are complete sentences.

      Positive signals

      - Comments are concentrated near the parsing flow.
      - Intent-revealing comments are separated from implementation details.

      Primary opportunity

      - Comments are complete sentences.

      Overall opinion

      I would ship this as-is. Removing complete-sentence comments that restate nearby code is the only improvement I would recommend before production.

      Scan complete

      Files scanned: 1
      Findings: 1

      [low] Comments are complete sentences
      src/index.ts:3

      Category: maintainability
      Confidence: high

      Summary

      Three comments in src/index.ts are complete sentences.

      Why it matters

      Comments are most useful when they explain non-obvious intent instead of restating code.

      Impact

      Repeated prose can make otherwise straightforward code harder to scan.

      Evidence

      - src/index.ts:3 — complete sentence
        // This parses command line arguments.
      - src/index.ts:11 — complete sentence
        // This handles missing input safely.
      - src/index.ts:20 — complete sentence
        // This writes normalized review output.

      Recommendation

      Remove complete-sentence comments that restate nearby code.
      "
    `);
  });

  it("uses the rule aggregate through the built package process boundary", async () => {
    const ruleId = "test.comments.complete-sentence.process";
    const script = `
      import { Adversary, defineRule, ruleRegistry } from ${JSON.stringify(
        new URL("../dist/index.js", import.meta.url).href,
      )};
      const ruleId = ${JSON.stringify(ruleId)};
      defineRule({
        id: ruleId,
        category: "maintainability",
        defaultSeverity: "low",
        aggregate(observations) {
          return {
            title: "Comments are complete sentences",
            confidence: "high",
            summary: "Three comments are complete sentences.",
            evidence: observations.map((observation) => ({
              file: observation.location?.file,
              line: observation.location?.line,
              message: "complete sentence",
              snippet: observation.evidence?.snippet,
              data: observation.evidence,
            })),
          };
        },
      });
      const app = new Adversary({ name: "comment-review", review: { minimumConfidence: "low" } });
      app.rule("comments", (ctx) => {
        for (const [line, snippet] of [[3, "// First complete sentence."], [11, "// Second complete sentence."], [20, "// Third complete sentence."]]) {
          ctx.observe({
            ruleId,
            subject: "src/index.ts",
            groupKey: \`\${ruleId}:src/index.ts\`,
            confidence: "medium",
            title: "Comment is a complete sentence",
            location: { file: "src/index.ts", line },
            evidence: { snippet },
          });
        }
      });
      const result = await app.run({ input: { source: { path: "/repo" } }, write: false });
      console.log(JSON.stringify({
        hasRule: ruleRegistry.has(ruleId),
        lookupRule: ruleRegistry.lookup(ruleId)?.id,
        finding: result.findings[0],
      }));
    `;

    const { stdout } = await execFileAsync(
      process.execPath,
      ["--input-type=module", "-e", script],
      {
        cwd: join(import.meta.dirname, ".."),
      },
    );
    const parsed = JSON.parse(stdout);

    expect(parsed.hasRule).toBe(true);
    expect(parsed.lookupRule).toBe(ruleId);
    expect(parsed.finding.title).toBe("Comments are complete sentences");
    expect(parsed.finding.confidence).toBe("high");
    expect(parsed.finding.summary).toBe("Three comments are complete sentences.");
    expect(parsed.finding.synthesisSource).toBe("rule");
    expect(parsed.finding.evidence).toHaveLength(3);
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

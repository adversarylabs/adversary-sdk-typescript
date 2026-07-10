# adversary-sdk-typescript

Small TypeScript SDK for building file-based Adversaries.

The SDK owns the runtime boilerplate: read runtime input, discover the source repository path,
execute registered rules, collect observations, synthesize findings, normalize and rank the review,
and write runtime output.

## Install

```bash
npm install @adversarylabs/sdk
```

Requires Node 22 or newer and ESM.

## Author an adversary

```ts
import { Adversary, Severity, log } from "@adversarylabs/sdk";

const app = new Adversary({
  name: "adversarylabs/comment-sentences"
});

app.defineRule({
  id: "comments.complete-sentence",
  category: "code-style",
  defaultSeverity: Severity.Info,
  groupBy: ["ruleId", "subject"],
  aggregate(observations) {
    return {
      title:
        observations.length === 1
          ? "Comment is a complete sentence"
          : "Comments contain complete sentences",
      confidence: "high",
      summary: `${observations.length} comments are written as complete sentences.`,
      recommendation:
        "Keep complete-sentence comments only when they explain non-obvious intent."
    };
  }
});

app.rule("comments.complete-sentence", async (ctx) => {
  log.debug(`scanning ${ctx.repoPath}`);

  ctx.observe({
    ruleId: "comments.complete-sentence",
    subject: "src/index.ts",
    confidence: "high",
    title: "Comment is a complete sentence",
    location: {
      file: "src/index.ts",
      line: 2
    },
    evidence: "This comment is a complete sentence.",
    recommendation: "Use complete-sentence comments intentionally where they clarify non-obvious code."
  });
});

await app.run();
```

## API

### `new Adversary(options)`

Creates an adversary app.

```ts
const app = new Adversary({
  name: "adversarylabs/example"
});
```

### `app.rule(ruleId, handler)`

Registers a rule. Rules report through `ctx.observe(...)`, `ctx.finding(...)`, and `ctx.review.*`.

Rule context exposes:

- `ctx.repoPath`
- `ctx.summary`
- `ctx.cache`
- `ctx.relpath(path)`
- `ctx.glob(pattern)`
- `ctx.rglob(pattern)`
- `ctx.observe(observation)`
- `ctx.finding(finding)`
- `ctx.review.assessment(assessment)`
- `ctx.review.positive(note)`
- `ctx.review.observe(note)`
- `ctx.review.opinion(opinion)`

### `app.defineRule(definition)`

Registers domain-specific aggregation for a stable rule id. The SDK still owns grouping,
deduplication, ranking, suppression, and rendering; the rule definition supplies engineering
language for a grouped set of observations.

```ts
app.defineRule({
  id: "comments.complete-sentence",
  category: "code-style",
  defaultSeverity: "info",
  defaultConfidence: "high",
  groupBy: ["ruleId", "subject"],
  aggregate(observations) {
    return {
      title:
        observations.length === 1
          ? "Comment is a complete sentence"
          : "Comments contain complete sentences",
      confidence: "high",
      summary: `${observations.length} comments are written as complete sentences.`,
      whyItMatters:
        "Comments are most useful when they explain non-obvious intent rather than restating code.",
      recommendation:
        "Keep complete-sentence comments only when they explain non-obvious intent."
    };
  }
});
```

`category`, `defaultSeverity`, `defaultConfidence`, and `groupBy` act as defaults for observations
with the same `ruleId`. If a rule has no `aggregate(...)`, the SDK uses generic synthesis.

Definitions are scoped to one `Adversary`. Duplicate IDs throw; use `app.replaceRule(...)` when an
intentional replacement is required. The top-level `defineRule(...)` API remains temporarily
available for compatibility but is deprecated.

### `ctx.observe(input)`

Use observations for raw detector output and evidence. Observations are normalized, deduplicated,
grouped, synthesized, ranked, and rendered by the SDK. Prefer this path for new adversaries.

Default grouping uses:

```text
ruleId + subject + category
```

Rule definitions can override this with `groupBy`. Individual observations can still override the
issue boundary with `groupKey`:

```ts
ctx.observe({
  ruleId: "comments.complete-sentence",
  subject: "src/index.ts",
  groupKey: "complete-sentence-comments",
  category: "code-style",
  severity: "info",
  confidence: 0.95,
  title: "Comments contain complete sentences",
  location: { file: "src/index.ts", line: 3 },
  evidence: { comment: "This comment is a complete sentence." },
  recommendation: {
    summary: "Use complete-sentence comments intentionally where they clarify non-obvious code."
  }
});
```

Set `deduplicate: false` only when repeated evidence is meaningful.

### `ctx.finding(input)`

Use completed findings when the adversary has already synthesized the issue:

```ts
ctx.finding({
  title: "Comments contain complete sentences",
  category: "code-style",
  severity: "info",
  confidence: "high",
  summary: "Three comments are written as complete sentences.",
  whyItMatters: "Complete-sentence comments can be useful for intent, but noisy when they restate code.",
  impact: "Reviewers may spend time reading comments that do not add much context.",
  evidence: [
    { file: "src/index.ts", line: 3, message: "Explains parser intent." },
    { file: "src/index.ts", line: 11, message: "Explains fallback behavior." },
    { file: "src/index.ts", line: 20, message: "Explains output formatting." }
  ],
  recommendation: "Keep complete-sentence comments only when they explain non-obvious intent.",
  remediation: { complexity: "trivial" }
});
```

Completed findings still pass through validation, deduplication, ranking, suppression, and
rendering.

`remediation.complexity` accepts `"trivial"`, `"small"`, `"medium"`, `"large"`, or
`"architectural"`. It remains available in structured output but is not rendered in the default
terminal review.

### Confidence

Confidence accepts `"low"`, `"medium"`, `"high"`, or a number from `0` to `1`.

Default numeric thresholds:

- `low`: less than `0.60`
- `medium`: `0.60` through `0.84`
- `high`: `0.85` and above

Customize thresholds with `new Adversary({ review: { confidenceThresholds } })`.

### Severity

The SDK uses severity as a review calibration signal, not just a detector label.

- `info`: interesting observations.
- `low`: reasonable engineering improvements.
- `medium`: issues likely to create operational problems.
- `high`: security, correctness, or reliability risks.
- `critical`: immediate production risk.

Override calibration when needed:

```ts
new Adversary({
  name: "adversarylabs/example",
  review: {
    severityOverrides: {
      "rule.id": "medium"
    }
  }
});
```

### Suppression and Ranking

Review policy controls human-readable output:

```ts
new Adversary({
  name: "adversarylabs/comment-sentences",
  review: {
    minimumConfidence: "medium",
    maximumFindings: 5,
    includeInformational: false
  }
});
```

By default, low-confidence and informational findings are suppressed from the primary review.
Suppressed findings are counted and can be included with `run({ includeSuppressed: true })`.
Raw observations can be included with `run({ includeRawObservations: true })`.

Ranking is deterministic and considers severity, confidence, affected evidence count, runtime or
production tags, and qualitative remediation complexity. It is not severity-only; a high-confidence
medium issue can rank above a speculative high-severity issue.

### Review Notes

Use review-level APIs for concise summaries that are not findings:

```ts
ctx.review.assessment({
  risk: "none",
  summary: "This review only reports complete-sentence comments."
});

ctx.review.positive({
  key: "intentional-comments",
  summary: "Several comments explain intent rather than restating implementation.",
  evidence: [{ file: "src/index.ts", line: 3 }]
});

ctx.review.observe({
  key: "sentence-style",
  summary: "Some comments are written as complete sentences."
});

ctx.review.opinion({
  ship: true,
  summary: "Comment sentence style does not block shipping."
});

ctx.review.score({
  key: "production-readiness",
  label: "Production readiness",
  score: 8.8,
  max: 10,
  summary: "Ready"
});
```

Scores are optional. They are included in JSON and rendered in terminal output when present.

### Observation-First Authoring

Prefer `ctx.observe(...)` for new adversaries. The intended flow is:

```text
observe -> group -> synthesize -> rank -> review
```

Adversaries should describe what they observed, where it happened, and why it matters. The SDK
should decide how observations group, which findings survive suppression, how they are ranked, and
how they are presented.

Use `ctx.finding(...)` when the adversary has already done issue synthesis itself.

### `log`

`log.debug()` and `log.info()` print only when `ADVERSARY_VERBOSE` is enabled with `1`, `true`,
`TRUE`, `yes`, or `YES`. `log.warn()` and `log.error()` always print. Logs go to stderr as:

```text
[adversary] level: message
```

## Review Result

`app.run()` returns one normalized review object:

```ts
type ReviewResult = {
  adversary: { name: string; version?: string };
  target: { repository?: string; filesScanned?: number };
  assessment?: { risk: "none" | "low" | "medium" | "high" | "critical"; summary?: string };
  positives: ReviewNote[];
  observations: ReviewNote[];
  scores?: ReviewScore[];
  findings: ReviewFinding[];
  opinion?: { ship?: boolean; summary: string };
  suppressed: { observations: number; findings: number };
  timing?: { totalMs?: number };
};
```

Renderers consume this result. The SDK includes `TerminalRenderer` and `JsonRenderer`:

```ts
const result = await app.run({ write: false });
new TerminalRenderer().render(result);
new JsonRenderer().render(result);
```

Adversary implementations should not manually format review output.

## Comment Sentence Example

`adversary.yaml`:

```yaml
name: comment-sentences
version: 0.1.0
description: Reports TypeScript comments that are written as complete sentences.

triggers:
  manual: true
  files_changed:
    - "*.ts"
    - "**/*.ts"

runtime:
  name: node
  version: "22"
  command:
    - dist/index.js

permissions:
  filesystem:
    read:
      - .
    write:
      - .adversary/results
  network: false
  env: []

findings:
  format: adversary.run.v1
```

`src/index.ts`:

```ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Adversary } from "@adversarylabs/sdk";

const app = new Adversary({
  name: "adversarylabs/comment-sentences",
  review: {
    minimumConfidence: "medium"
  }
});

app.defineRule({
  id: "comments.complete-sentence",
  category: "code-style",
  defaultSeverity: "info",
  defaultConfidence: "high",
  groupBy: ["ruleId", "subject"],
  aggregate(observations) {
    return {
      title:
        observations.length === 1
          ? "Comment is a complete sentence"
          : "Comments contain complete sentences",
      confidence: "high",
      summary: `${observations.length} comments in ${observations[0]?.subject ?? "the file"} are written as complete sentences.`,
      whyItMatters:
        "Comments are most useful when they explain non-obvious intent rather than restating code.",
      impact: "Repeated prose can make routine code harder to scan during review.",
      evidence: observations.map((observation) => ({
        file: observation.location?.file,
        line: observation.location?.line,
        message: "complete sentence",
        snippet:
          typeof observation.evidence === "object" && observation.evidence !== null
            ? String(observation.evidence.comment)
            : undefined,
        data:
          typeof observation.evidence === "object" && observation.evidence !== null
            ? observation.evidence
            : undefined
      })),
      recommendation:
        "Keep complete-sentence comments only when they explain non-obvious intent.",
      remediation: {
        complexity: "trivial"
      }
    };
  }
});

app.rule("comments.complete-sentence", async (ctx) => {
  const files = await ctx.rglob("*.ts");
  ctx.summary.files_scanned = files.length;

  for (const file of files) {
    const content = await readFile(join(ctx.repoPath, file), "utf8");
    const lines = content.split(/\r?\n/);

    lines.forEach((line, index) => {
      const match = line.match(/^\s*\/\/\s+(.+)/);
      if (!match) {
        return;
      }

      const comment = match[1] ?? "";
      if (!/^[A-Z][^.!?]*[.!?]$/.test(comment)) {
        return;
      }

      ctx.observe({
        ruleId: "comments.complete-sentence",
        subject: file,
        confidence: "high",
        title: "Comment is a complete sentence",
        location: {
          file,
          line: index + 1
        },
        evidence: {
          comment
        },
        tags: ["style"]
      });
    });
  }

  ctx.review.assessment({
    risk: "none",
    summary: "This review only reports complete-sentence comments."
  });

  ctx.review.opinion({
    ship: true,
    summary: "Comment sentence style does not block shipping."
  });
});

export default app;
```

## Runtime Contract

Input is read from `ADVERSARY_INPUT` when set, otherwise:

```text
/adversary/input.json
```

Expected input:

```json
{
  "source": {
    "path": "/repo"
  }
}
```

Output is written to `ADVERSARY_OUTPUT` when set, otherwise:

```text
/adversary/output.json
```

Output shape:

```json
{
  "protocolVersion": 1,
  "result": {
    "schemaVersion": "adversary.review.v1",
    "adversary": {
      "name": "adversarylabs/example"
    },
    "target": {
      "repository": "/repo",
      "filesScanned": 2
    },
    "positives": [],
    "observations": [],
    "findings": [],
    "suppressed": {
      "observations": 0,
      "findings": 0
    }
  }
}
```

## Development

```bash
npm install
npm test
npm run build
npm run lint
```

## CI and Release

Depot CI workflows live in `.depot/workflows/`.

- Pull requests run lint, tests, and build.
- Tags matching `v*` run lint, tests, build, verify the tag matches `package.json`, and publish to npm.

Publishing requires an `NPM_TOKEN` secret in Depot CI. Release tags should match the package
version, for example `v0.1.0`.

With direnv:

```bash
direnv allow
```

The Nix flake provides Node 22 and npm.

# adversary-sdk-typescript

Small TypeScript SDK for building file-based Adversaries.

The SDK owns the runtime boilerplate: read `/adversary/input.json`, discover the source
repository path, execute registered rules, collect observations and findings, normalize and rank
the review, and write `/adversary/output.json`.

## Install

```bash
npm install @adversary/sdk
```

Requires Node 22 or newer and ESM.

## Author an adversary

```ts
import { Adversary, Severity, log } from "@adversary/sdk";

const app = new Adversary({
  name: "adversarylabs/dockerfile",
  schemaVersion: "adversary.findings.v1"
});

app.rule("docker.user.root", async (ctx) => {
  log.debug(`scanning ${ctx.repoPath}`);

  ctx.observe({
    ruleId: "docker.user.root",
    subject: "Dockerfile.root",
    category: "container-hardening",
    severity: Severity.Medium,
    confidence: "high",
    title: "Container runs as root",
    location: {
      file: "Dockerfile.root",
      line: 2
    },
    evidence: "USER root",
    recommendation: "Run as a non-root user where possible."
  });
});

await app.run();
```

## API

### `new Adversary(options)`

Creates an adversary app.

```ts
const app = new Adversary({
  name: "adversarylabs/example",
  schemaVersion: "adversary.findings.v1"
});
```

### `app.rule(ruleId, handler)`

Registers a rule. Prefer reporting through `ctx.observe(...)` or `ctx.finding(...)`. A rule may
still return `undefined`, `null`, one legacy `Finding`, or an array of legacy `Finding` objects.

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

### `ctx.observe(input)`

Use observations for raw detector output and evidence. Observations are normalized, deduplicated,
grouped, ranked, and rendered by the SDK.

Default grouping uses:

```text
ruleId + subject + category
```

Override it with `groupKey` when the detector knows the exact issue boundary:

```ts
ctx.observe({
  ruleId: "base-image-unpinned",
  subject: "node:22-bookworm-slim",
  groupKey: "unpinned-node-base-image",
  category: "supply-chain",
  severity: "low",
  confidence: 0.95,
  title: "Base images are not pinned by digest",
  location: { file: "Dockerfile", line: 3 },
  evidence: { stage: "deps", instruction: "FROM node:22-bookworm-slim AS deps" },
  recommendation: {
    summary: "Pin production base images by digest when reproducibility matters.",
    details: "Use Renovate or Dependabot to keep pinned digests current."
  }
});
```

Set `deduplicate: false` only when repeated evidence is meaningful.

### `ctx.finding(input)`

Use completed findings when the adversary has already synthesized the issue:

```ts
ctx.finding({
  title: "Base images are not pinned by digest",
  category: "supply-chain",
  severity: "low",
  confidence: "high",
  summary: "Three build stages reference node:22-bookworm-slim by tag rather than digest.",
  whyItMatters: "Tags are mutable and can resolve to different images over time.",
  impact: "Future builds may consume different base images even when the Dockerfile has not changed.",
  evidence: [
    { file: "Dockerfile", line: 3, message: "deps stage" },
    { file: "Dockerfile", line: 11, message: "builder stage" },
    { file: "Dockerfile", line: 20, message: "runner stage" }
  ],
  recommendation:
    "Pin production images using image:tag@sha256:<digest> and automate digest updates.",
  remediation: { estimate: "10-20 minutes" }
});
```

Completed findings still pass through validation, deduplication, ranking, suppression, and
rendering.

### Confidence

Confidence accepts `"low"`, `"medium"`, `"high"`, or a number from `0` to `1`.

Default numeric thresholds:

- `low`: less than `0.60`
- `medium`: `0.60` through `0.84`
- `high`: `0.85` and above

Customize thresholds with `new Adversary({ review: { confidenceThresholds } })`.

### Suppression and Ranking

Review policy controls human-readable output:

```ts
new Adversary({
  name: "adversarylabs/dockerfile",
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
production tags, and remediation hints. It is not severity-only; a high-confidence medium issue can
rank above a speculative high-severity issue.

### Review Notes

Use review-level APIs for concise summaries that are not findings:

```ts
ctx.review.assessment({
  risk: "low",
  summary: "This is a well-structured multi-stage Node Dockerfile."
});

ctx.review.positive({
  key: "multi-stage-build",
  summary: "Dependency installation, build, and runtime are separated cleanly.",
  evidence: [{ file: "Dockerfile", line: 3 }]
});

ctx.review.observe({
  key: "minimal-runtime-stage",
  summary: "The runtime stage reuses built artifacts rather than rebuilding them."
});

ctx.review.opinion({
  ship: true,
  summary: "I would ship this Dockerfile as-is. Digest pinning is the only material improvement identified."
});
```

### `new Finding(input)`

Creates a legacy CLI-compatible finding. `id` defaults to `ruleId`; `file` defaults to `path`.
Prefer `ctx.finding(...)` for new adversaries. `ctx.findings.add(...)` remains as a deprecated
compatibility wrapper.

### `Severity`

Use `Severity.Info`, `Severity.Low`, `Severity.Medium`, `Severity.High`, or
`Severity.Critical`. Values serialize as lowercase strings.

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
  format: adversary.findings.v1
```

`src/index.ts`:

```ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Adversary } from "@adversary/sdk";

const app = new Adversary({
  name: "adversarylabs/comment-sentences",
  review: {
    minimumConfidence: "medium"
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
        category: "code-style",
        severity: "info",
        confidence: "high",
        title: "Comments contain complete sentences",
        location: {
          file,
          line: index + 1
        },
        evidence: {
          comment
        },
        recommendation: {
          summary: "Use complete-sentence comments intentionally where they clarify non-obvious code."
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

Input is read from:

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

Output is written to:

```text
/adversary/output.json
```

Output shape:

```json
{
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
```

The SDK still accepts legacy `Finding` objects returned from rules and adapts them into normalized
review findings.

## Development

```bash
npm install
npm test
npm run build
npm run lint
```

With direnv:

```bash
direnv allow
```

The Nix flake provides Node 22 and npm.

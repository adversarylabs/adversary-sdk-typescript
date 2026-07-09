import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export const DEFAULT_INPUT_PATH = "/adversary/input.json";
export const DEFAULT_OUTPUT_PATH = "/adversary/output.json";
export const FINDINGS_SCHEMA_VERSION = "adversary.findings.v1";

const verboseValues = new Set(["1", "true", "TRUE", "yes", "YES"]);

export const Severity = {
  Info: "info",
  Low: "low",
  Medium: "medium",
  High: "high",
  Critical: "critical",
} as const;

export type Severity = (typeof Severity)[keyof typeof Severity];

export const Confidence = {
  Low: "low",
  Medium: "medium",
  High: "high",
} as const;

export type Confidence = (typeof Confidence)[keyof typeof Confidence];
export type ConfidenceInput = Confidence | number;

export interface ConfidenceThresholds {
  medium: number;
  high: number;
}

export const DEFAULT_CONFIDENCE_THRESHOLDS: ConfidenceThresholds = {
  medium: 0.6,
  high: 0.85,
};

export interface Evidence {
  file?: string;
  line?: number;
  endLine?: number;
  message?: string;
  snippet?: string;
  metadata?: Record<string, unknown>;
}

export interface Remediation {
  estimate?: string;
  complexity?: "trivial" | "small" | "medium" | "large";
}

export interface RecommendationInput {
  summary: string;
  details?: string;
}

export interface ObservationInit {
  ruleId: string;
  subject: string;
  groupKey?: string;
  deduplicate?: boolean;
  category: string;
  severity: Severity;
  confidence: ConfidenceInput;
  title: string;
  location?: Evidence;
  evidence?: string | Record<string, unknown>;
  recommendation?: string | RecommendationInput;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface FindingInput {
  id?: string;
  ruleId?: string;
  groupKey?: string;
  deduplicate?: boolean;
  title: string;
  category: string;
  severity: Severity;
  confidence: ConfidenceInput;
  summary: string;
  whyItMatters?: string;
  impact?: string;
  evidence: Evidence[];
  recommendation?: string;
  remediation?: Remediation;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface ReviewFinding {
  id: string;
  ruleId?: string;
  groupKey?: string;
  title: string;
  category: string;
  severity: Severity;
  confidence: Confidence;
  summary: string;
  whyItMatters?: string;
  impact?: string;
  evidence: Evidence[];
  recommendation?: string;
  remediation?: Remediation;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface ReviewNote {
  key: string;
  summary: string;
  evidence?: Evidence[];
  metadata?: Record<string, unknown>;
}

export interface ReviewAssessment {
  risk: "none" | "low" | "medium" | "high" | "critical";
  summary?: string;
}

export interface ReviewOpinion {
  ship?: boolean;
  summary: string;
}

export interface ReviewPolicy {
  minimumConfidence?: Confidence;
  maximumFindings?: number;
  includeInformational?: boolean;
  confidenceThresholds?: ConfidenceThresholds;
}

export interface ReviewResult {
  adversary: {
    name: string;
    version?: string;
  };
  target: {
    repository?: string;
    filesScanned?: number;
  };
  assessment?: ReviewAssessment;
  positives: ReviewNote[];
  observations: ReviewNote[];
  findings: ReviewFinding[];
  opinion?: ReviewOpinion;
  suppressed: {
    observations: number;
    findings: number;
  };
  timing?: {
    buildMs?: number;
    startupMs?: number;
    scanMs?: number;
    totalMs?: number;
  };
  suppressedFindings?: ReviewFinding[];
  rawObservations?: ObservationInit[];
}

export interface RuntimeInput {
  source: {
    path: string;
  };
  [key: string]: unknown;
}

export interface Summary {
  files_scanned?: number;
  rules_executed?: number;
  [key: string]: number | string | boolean | null | undefined;
}

export interface FindingInit {
  ruleId: string;
  id?: string;
  severity: Severity;
  title: string;
  message?: string;
  path?: string;
  file?: string;
  line?: number;
  column?: number;
  evidence?: string;
  recommendation?: string;
  metadata?: Record<string, unknown>;
}

export interface SerializedFinding {
  rule_id: string;
  id: string;
  severity: Severity;
  title: string;
  message?: string;
  path?: string;
  file?: string;
  line?: number;
  column?: number;
  evidence?: string;
  recommendation?: string;
  metadata?: Record<string, unknown>;
}

export interface Output {
  schema_version: typeof FINDINGS_SCHEMA_VERSION;
  adversary: string;
  summary: Summary;
  findings: SerializedFinding[];
}

export interface RuleContext {
  repoPath: string;
  summary: Summary;
  cache: Map<string, unknown>;
  relpath: (path: string) => string;
  glob: (pattern: string) => Promise<string[]>;
  rglob: (pattern: string) => Promise<string[]>;
  observe: (observation: ObservationInit) => void;
  finding: (finding: FindingInput) => void;
  findings: {
    /** @deprecated Use ctx.finding(...) for normalized review findings. */
    add: (finding: Finding | FindingInit) => void;
  };
  review: {
    assessment: (assessment: ReviewAssessment) => void;
    positive: (note: ReviewNote) => void;
    observe: (note: ReviewNote) => void;
    opinion: (opinion: ReviewOpinion) => void;
  };
}

export type RuleResult = undefined | null | Finding | Finding[];
export type RuleHandler = (context: RuleContext) => RuleResult | Promise<RuleResult>;

export interface AdversaryOptions {
  name: string;
  version?: string;
  schemaVersion?: typeof FINDINGS_SCHEMA_VERSION;
  review?: ReviewPolicy;
}

export interface RunOptions {
  input?: RuntimeInput;
  inputPath?: string;
  outputPath?: string;
  write?: boolean;
  review?: ReviewPolicy;
  includeSuppressed?: boolean;
  includeRawObservations?: boolean;
}

export interface ReviewRenderer {
  render(result: ReviewResult): Promise<void> | void;
}

export const log = {
  debug(message: unknown): void {
    if (isVerbose()) {
      writeLog("debug", message);
    }
  },

  info(message: unknown): void {
    if (isVerbose()) {
      writeLog("info", message);
    }
  },

  warn(message: unknown): void {
    writeLog("warn", message);
  },

  error(message: unknown): void {
    writeLog("error", message);
  },
};

export class Finding {
  readonly ruleId: string;
  readonly id: string;
  readonly severity: Severity;
  readonly title: string;
  readonly message?: string;
  readonly path?: string;
  readonly file?: string;
  readonly line?: number;
  readonly column?: number;
  readonly evidence?: string;
  readonly recommendation?: string;
  readonly metadata?: Record<string, unknown>;

  constructor(init: FindingInit) {
    assertFindingInit(init);

    this.ruleId = init.ruleId;
    this.id = init.id ?? init.ruleId;
    this.severity = init.severity;
    this.title = init.title;
    this.message = init.message;
    this.path = init.path;
    this.file = init.file ?? init.path;
    this.line = init.line;
    this.column = init.column;
    this.evidence = init.evidence;
    this.recommendation = init.recommendation;
    this.metadata = init.metadata;
  }

  toJSON(): SerializedFinding {
    return omitUndefined({
      rule_id: this.ruleId,
      id: this.id,
      severity: this.severity,
      title: this.title,
      message: this.message,
      path: this.path,
      file: this.file,
      line: this.line,
      column: this.column,
      evidence: this.evidence,
      recommendation: this.recommendation,
      metadata: this.metadata,
    });
  }
}

export class Adversary {
  readonly name: string;
  readonly version?: string;
  readonly schemaVersion: typeof FINDINGS_SCHEMA_VERSION;
  readonly rules: Array<{ id: string; handler: RuleHandler }> = [];
  readonly reviewPolicy: ReviewPolicy;

  constructor(options: AdversaryOptions) {
    if (options.name.length === 0) {
      throw new Error("Adversary name must be a non-empty string.");
    }

    if (options.schemaVersion !== undefined && options.schemaVersion !== FINDINGS_SCHEMA_VERSION) {
      throw new Error(`Unsupported schemaVersion "${options.schemaVersion}".`);
    }

    this.name = options.name;
    this.version = options.version;
    this.schemaVersion = options.schemaVersion ?? FINDINGS_SCHEMA_VERSION;
    this.reviewPolicy = options.review ?? {};
  }

  rule(id: string, handler: RuleHandler): void {
    if (id.length === 0) {
      throw new Error("Rule id must be a non-empty string.");
    }

    this.rules.push({ id, handler });
  }

  async run(options: RunOptions = {}): Promise<ReviewResult> {
    const startedAt = performance.now();
    const input = options.input ?? (await parseInput(options.inputPath));
    const repoPath = input.source.path;
    const summary: Summary = {};
    const cache = new Map<string, unknown>();
    const collector = createReviewCollector();
    const context = createRuleContext(repoPath, summary, cache, collector);
    const findings: SerializedFinding[] = [];

    for (const rule of this.rules) {
      log.debug(`running rule ${rule.id}`);
      const result = await rule.handler(context);
      findings.push(...normalizeRuleResult(result));
    }

    for (const finding of findings) {
      collector.findings.push(legacyFindingToReviewFinding(finding));
    }

    if (summary.rules_executed === undefined) {
      summary.rules_executed = this.rules.length;
    }

    const legacyOutput: Output = {
      schema_version: this.schemaVersion,
      adversary: this.name,
      summary,
      findings: sortFindings(findings),
    };
    const output = buildReviewResult({
      adversary: { name: this.name, version: this.version },
      repository: repoPath,
      filesScanned: typeof summary.files_scanned === "number" ? summary.files_scanned : undefined,
      collector,
      policy: { ...this.reviewPolicy, ...options.review },
      includeSuppressed: options.includeSuppressed,
      includeRawObservations: options.includeRawObservations,
      timing: { totalMs: Math.round(performance.now() - startedAt) },
    });

    if (options.write !== false) {
      await writeOutput(output, options.outputPath);
    }

    return output;
  }
}

export async function parseInput(path = DEFAULT_INPUT_PATH): Promise<RuntimeInput> {
  const raw = await readFile(path, "utf8");
  const parsed: unknown = JSON.parse(raw);

  if (!isRecord(parsed)) {
    throw new Error(`Invalid input at ${path}: expected an object.`);
  }

  if (!isRecord(parsed.source)) {
    throw new Error(`Invalid input at ${path}: source must be an object.`);
  }

  if (typeof parsed.source.path !== "string" || parsed.source.path.length === 0) {
    throw new Error(`Invalid input at ${path}: source.path must be a non-empty string.`);
  }

  return parsed as RuntimeInput;
}

export async function writeOutput(output: unknown, path = DEFAULT_OUTPUT_PATH): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(output, null, 2)}\n`, "utf8");
}

export function normalizeConfidence(
  confidence: ConfidenceInput,
  thresholds: ConfidenceThresholds = DEFAULT_CONFIDENCE_THRESHOLDS,
): Confidence {
  if (isConfidence(confidence)) {
    return confidence;
  }

  if (
    typeof confidence !== "number" ||
    Number.isNaN(confidence) ||
    confidence < 0 ||
    confidence > 1
  ) {
    throw new Error("confidence must be low, medium, high, or a number from 0 to 1.");
  }

  if (confidence >= thresholds.high) {
    return Confidence.High;
  }

  if (confidence >= thresholds.medium) {
    return Confidence.Medium;
  }

  return Confidence.Low;
}

export function rankFindings(findings: ReviewFinding[]): ReviewFinding[] {
  return [...findings].sort((left, right) => {
    const scoreComparison = scoreFinding(right) - scoreFinding(left);
    if (scoreComparison !== 0) {
      return scoreComparison;
    }

    const severityComparison = severityWeight(right.severity) - severityWeight(left.severity);
    if (severityComparison !== 0) {
      return severityComparison;
    }

    const titleComparison = compareStrings(left.title, right.title);
    if (titleComparison !== 0) {
      return titleComparison;
    }

    return compareStrings(left.id, right.id);
  });
}

export class JsonRenderer implements ReviewRenderer {
  constructor(
    private readonly write: (text: string) => void = (text) => process.stdout.write(text),
  ) {}

  render(result: ReviewResult): void {
    this.write(`${JSON.stringify(result, null, 2)}\n`);
  }
}

export class TerminalRenderer implements ReviewRenderer {
  constructor(
    private readonly write: (text: string) => void = (text) => process.stdout.write(text),
  ) {}

  render(result: ReviewResult): void {
    const lines: string[] = [];
    lines.push(`Adversary: ${result.adversary.name}`);
    if (result.target.repository !== undefined) {
      lines.push(`Repository: ${result.target.repository}`);
    }
    lines.push("");

    if (result.assessment !== undefined) {
      lines.push("Overall assessment", "");
      lines.push(`Risk: ${capitalize(result.assessment.risk)}`, "");
      if (result.assessment.summary !== undefined) {
        lines.push(result.assessment.summary, "");
      }
    }

    const primary = result.findings[0];
    if (primary !== undefined) {
      lines.push("Primary opportunity", "");
      lines.push(`- ${primary.title.endsWith(".") ? primary.title : `${primary.title}.`}`, "");
    }

    if (result.opinion !== undefined) {
      lines.push("Overall opinion", "", result.opinion.summary, "");
    }

    lines.push("Scan complete", "");
    if (result.target.filesScanned !== undefined) {
      lines.push(`Files scanned: ${result.target.filesScanned}`);
    }
    lines.push(`Findings: ${result.findings.length}`, "");

    for (const finding of result.findings) {
      lines.push(`[${finding.severity}] ${finding.title}`);
      const firstEvidence = finding.evidence.find((item) => item.file !== undefined);
      if (firstEvidence?.file !== undefined) {
        lines.push(formatEvidenceLocation(firstEvidence));
      }
      lines.push("");
      lines.push(`Category: ${finding.category}`);
      lines.push(`Confidence: ${finding.confidence}`, "");
      lines.push("Summary", "", finding.summary, "");

      if (finding.whyItMatters !== undefined) {
        lines.push("Why it matters", "", finding.whyItMatters, "");
      }

      if (finding.impact !== undefined) {
        lines.push("Impact", "", finding.impact, "");
      }

      if (finding.evidence.length > 0) {
        lines.push("Evidence", "");
        for (const evidence of finding.evidence) {
          lines.push(`- ${formatEvidence(evidence)}`);
        }
        lines.push("");
      }

      if (finding.recommendation !== undefined) {
        lines.push("Recommendation", "", finding.recommendation, "");
      }

      if (finding.remediation?.estimate !== undefined) {
        lines.push("Estimated remediation", "", finding.remediation.estimate, "");
      }
    }

    this.write(`${lines.join("\n").trimEnd()}\n`);
  }
}

export function sortFindings(findings: SerializedFinding[]): SerializedFinding[] {
  return [...findings].sort((left, right) => {
    const pathComparison = compareStrings(left.path ?? "", right.path ?? "");
    if (pathComparison !== 0) {
      return pathComparison;
    }

    const lineComparison = compareNumbers(left.line, right.line);
    if (lineComparison !== 0) {
      return lineComparison;
    }

    return compareStrings(left.rule_id, right.rule_id);
  });
}

function createRuleContext(
  repoPath: string,
  summary: Summary,
  cache: Map<string, unknown>,
  collector: ReviewCollector,
): RuleContext {
  const absoluteRepoPath = resolve(repoPath);

  return {
    repoPath: absoluteRepoPath,
    summary,
    cache,
    relpath(path: string): string {
      return relative(absoluteRepoPath, isAbsolute(path) ? path : resolve(absoluteRepoPath, path));
    },
    glob(pattern: string): Promise<string[]> {
      return findMatchingPaths(absoluteRepoPath, pattern, false);
    },
    rglob(pattern: string): Promise<string[]> {
      return findMatchingPaths(absoluteRepoPath, pattern, true);
    },
    observe(observation: ObservationInit): void {
      assertObservationInit(observation, "ctx.observe");
      collector.observations.push(observation);
    },
    finding(finding: FindingInput): void {
      assertFindingInput(finding, "ctx.finding");
      collector.findings.push(normalizeFindingInput(finding));
    },
    findings: {
      add(finding: Finding | FindingInit): void {
        const normalized = finding instanceof Finding ? finding : new Finding(finding);
        collector.findings.push(legacyFindingToReviewFinding(normalized.toJSON()));
      },
    },
    review: {
      assessment(assessment: ReviewAssessment): void {
        assertAssessment(assessment);
        collector.assessment = assessment;
      },
      positive(note: ReviewNote): void {
        assertReviewNote(note, "ctx.review.positive");
        collector.positives.push(note);
      },
      observe(note: ReviewNote): void {
        assertReviewNote(note, "ctx.review.observe");
        collector.reviewObservations.push(note);
      },
      opinion(opinion: ReviewOpinion): void {
        assertOpinion(opinion);
        collector.opinion = opinion;
      },
    },
  };
}

function normalizeRuleResult(result: RuleResult): SerializedFinding[] {
  if (result === undefined || result === null) {
    return [];
  }

  const findings = Array.isArray(result) ? result : [result];
  return findings.map((item) => item.toJSON());
}

async function findMatchingPaths(
  repoPath: string,
  pattern: string,
  recursive: boolean,
): Promise<string[]> {
  const matcher = globPatternToRegExp(pattern);
  const paths = recursive ? await walk(repoPath) : await listFiles(repoPath);

  return paths
    .map((path) => relative(repoPath, path))
    .filter((path) => {
      const posixPath = toPosixPath(path);
      const candidate = recursive && !pattern.includes("/") ? basename(posixPath) : posixPath;
      return matcher.test(candidate);
    })
    .sort(compareStrings);
}

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => resolve(directory, entry.name));
}

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths: string[] = [];

  for (const entry of entries) {
    const path = resolve(directory, entry.name);

    if (entry.isDirectory()) {
      paths.push(...(await walk(path)));
    } else if (entry.isFile()) {
      paths.push(path);
    }
  }

  return paths;
}

function globPatternToRegExp(pattern: string): RegExp {
  const source = toPosixPath(pattern)
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\0")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\0/g, ".*");

  return new RegExp(`^${source}$`);
}

function assertFindingInit(value: FindingInit): void {
  requireString(value.ruleId, "ruleId");
  requireString(value.title, "title");

  if (!isSeverity(value.severity)) {
    throw new Error("Finding severity must be one of Severity.Info, Low, Medium, High, Critical.");
  }

  optionalString(value.id, "id");
  optionalString(value.message, "message");
  optionalString(value.path, "path");
  optionalString(value.file, "file");
  optionalPositiveInteger(value.line, "line");
  optionalPositiveInteger(value.column, "column");
  optionalString(value.evidence, "evidence");
  optionalString(value.recommendation, "recommendation");

  if (value.metadata !== undefined && !isRecord(value.metadata)) {
    throw new Error("Finding metadata must be an object.");
  }
}

interface ReviewCollector {
  observations: ObservationInit[];
  findings: ReviewFinding[];
  assessment?: ReviewAssessment;
  positives: ReviewNote[];
  reviewObservations: ReviewNote[];
  opinion?: ReviewOpinion;
}

function createReviewCollector(): ReviewCollector {
  return {
    observations: [],
    findings: [],
    positives: [],
    reviewObservations: [],
  };
}

function buildReviewResult(input: {
  adversary: ReviewResult["adversary"];
  repository: string;
  filesScanned?: number;
  collector: ReviewCollector;
  policy: ReviewPolicy;
  includeSuppressed?: boolean;
  includeRawObservations?: boolean;
  timing?: ReviewResult["timing"];
}): ReviewResult {
  const thresholds = input.policy.confidenceThresholds ?? DEFAULT_CONFIDENCE_THRESHOLDS;
  const synthesized = synthesizeObservationFindings(input.collector.observations, thresholds);
  const allFindings = deduplicateFindings([...synthesized, ...input.collector.findings]);
  const ranked = rankFindings(allFindings);
  const minimumConfidence = input.policy.minimumConfidence ?? Confidence.Medium;
  const includeInformational = input.policy.includeInformational ?? false;
  const maximumFindings = input.policy.maximumFindings ?? Number.POSITIVE_INFINITY;
  const eligible: ReviewFinding[] = [];
  const suppressedFindings: ReviewFinding[] = [];

  for (const finding of ranked) {
    const suppressed =
      confidenceWeight(finding.confidence) < confidenceWeight(minimumConfidence) ||
      (!includeInformational && finding.severity === Severity.Info) ||
      eligible.length >= maximumFindings;

    if (suppressed) {
      suppressedFindings.push(finding);
    } else {
      eligible.push(finding);
    }
  }

  return omitUndefined({
    adversary: input.adversary,
    target: omitUndefined({
      repository: input.repository,
      filesScanned: input.filesScanned,
    }),
    assessment: input.collector.assessment,
    positives: deduplicateNotes(input.collector.positives),
    observations: deduplicateNotes(input.collector.reviewObservations),
    findings: eligible,
    opinion: input.collector.opinion,
    suppressed: {
      observations: 0,
      findings: suppressedFindings.length,
    },
    timing: input.timing,
    suppressedFindings: input.includeSuppressed ? suppressedFindings : undefined,
    rawObservations: input.includeRawObservations ? input.collector.observations : undefined,
  }) as ReviewResult;
}

function synthesizeObservationFindings(
  observations: ObservationInit[],
  thresholds: ConfidenceThresholds,
): ReviewFinding[] {
  const grouped = new Map<string, ObservationInit[]>();
  const seen = new Set<string>();

  for (const observation of observations) {
    const groupKey = observation.groupKey ?? defaultObservationGroupKey(observation);
    const dedupeKey = stableStringify({ groupKey, observation });
    if (observation.deduplicate !== false && seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    grouped.set(groupKey, [...(grouped.get(groupKey) ?? []), observation]);
  }

  return [...grouped.entries()].map(([groupKey, group]) => {
    const first = group[0];
    if (first === undefined) {
      throw new Error("Cannot synthesize finding from an empty observation group.");
    }

    const evidence = deduplicateEvidence(group.map(observationToEvidence));
    const recommendation = uniqueStrings(
      group.flatMap((observation) => {
        if (typeof observation.recommendation === "string") {
          return [observation.recommendation];
        }
        if (observation.recommendation !== undefined) {
          return [observation.recommendation.summary, observation.recommendation.details].filter(
            isNonEmptyString,
          );
        }
        return [];
      }),
    ).join("\n\n");
    const confidence = strongestConfidence(
      group.map((observation) => normalizeConfidence(observation.confidence, thresholds)),
    );

    return {
      id: stableId(`${first.ruleId}:${groupKey}`),
      ruleId: first.ruleId,
      groupKey,
      title: first.title,
      category: first.category,
      severity: strongestSeverity(group.map((observation) => observation.severity)),
      confidence,
      summary: summarizeObservationGroup(first, group.length),
      evidence,
      recommendation: recommendation.length > 0 ? recommendation : undefined,
      tags: uniqueStrings(group.flatMap((observation) => observation.tags ?? [])),
      metadata: first.metadata,
    };
  });
}

function normalizeFindingInput(input: FindingInput): ReviewFinding {
  return omitUndefined({
    id: input.id ?? stableId(`${input.ruleId ?? input.title}:${input.groupKey ?? input.category}`),
    ruleId: input.ruleId,
    groupKey: input.groupKey,
    title: input.title,
    category: input.category,
    severity: input.severity,
    confidence: normalizeConfidence(input.confidence),
    summary: input.summary,
    whyItMatters: input.whyItMatters,
    impact: input.impact,
    evidence: deduplicateEvidence(input.evidence),
    recommendation: input.recommendation,
    remediation: input.remediation,
    tags: input.tags === undefined ? undefined : uniqueStrings(input.tags),
    metadata: input.metadata,
  }) as ReviewFinding;
}

function legacyFindingToReviewFinding(input: SerializedFinding): ReviewFinding {
  const evidence = deduplicateEvidence([
    omitUndefined({
      file: input.file ?? input.path,
      line: input.line,
      message: input.evidence ?? input.message,
      metadata: input.column === undefined ? undefined : { column: input.column },
    }),
  ]);

  return {
    id: input.id,
    ruleId: input.rule_id,
    title: input.title,
    category: "legacy",
    severity: input.severity,
    confidence: Confidence.Medium,
    summary: input.message ?? input.title,
    evidence,
    recommendation: input.recommendation,
    metadata: input.metadata,
  };
}

function deduplicateFindings(findings: ReviewFinding[]): ReviewFinding[] {
  const seen = new Set<string>();
  const result: ReviewFinding[] = [];

  for (const finding of findings) {
    const key = finding.groupKey ?? finding.id;
    if (seen.has(key)) {
      const existing = result.find((item) => (item.groupKey ?? item.id) === key);
      if (existing !== undefined) {
        existing.evidence = deduplicateEvidence([...existing.evidence, ...finding.evidence]);
        existing.tags = uniqueStrings([...(existing.tags ?? []), ...(finding.tags ?? [])]);
      }
      continue;
    }
    seen.add(key);
    result.push({ ...finding, evidence: deduplicateEvidence(finding.evidence) });
  }

  return result;
}

function deduplicateEvidence(evidence: Evidence[]): Evidence[] {
  const seen = new Set<string>();
  const result: Evidence[] = [];

  for (const item of evidence) {
    const normalized = omitUndefined(item as Record<string, unknown>) as Evidence;
    const key = stableStringify(normalized);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(normalized);
    }
  }

  return result.sort((left, right) => {
    const fileComparison = compareStrings(left.file ?? "", right.file ?? "");
    if (fileComparison !== 0) {
      return fileComparison;
    }
    const lineComparison = compareNumbers(left.line, right.line);
    if (lineComparison !== 0) {
      return lineComparison;
    }
    return compareStrings(left.message ?? "", right.message ?? "");
  });
}

function deduplicateNotes(notes: ReviewNote[]): ReviewNote[] {
  const seen = new Set<string>();
  const result: ReviewNote[] = [];

  for (const note of notes) {
    const normalized = {
      ...note,
      evidence: note.evidence === undefined ? undefined : deduplicateEvidence(note.evidence),
    };
    const key = note.key;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(normalized);
    }
  }

  return result.sort((left, right) => compareStrings(left.key, right.key));
}

function observationToEvidence(observation: ObservationInit): Evidence {
  const metadata = isRecord(observation.evidence)
    ? observation.evidence
    : observation.evidence === undefined
      ? undefined
      : { evidence: observation.evidence };
  const message = isRecord(observation.evidence)
    ? (stringFromUnknown(observation.evidence.message) ??
      stringFromUnknown(observation.evidence.stage) ??
      stringFromUnknown(observation.evidence.instruction))
    : stringFromUnknown(observation.evidence);

  return omitUndefined({
    file: observation.location?.file,
    line: observation.location?.line,
    endLine: observation.location?.endLine,
    message: observation.location?.message ?? message,
    snippet: observation.location?.snippet,
    metadata,
  });
}

function summarizeObservationGroup(first: ObservationInit, count: number): string {
  const recommendation =
    typeof first.recommendation === "string" ? undefined : first.recommendation?.summary;
  if (count === 1) {
    return recommendation ?? first.title;
  }
  return `${count} related observations were reported for ${first.subject}.`;
}

function defaultObservationGroupKey(observation: ObservationInit): string {
  return `${observation.ruleId}:${observation.subject}:${observation.category}`;
}

function scoreFinding(finding: ReviewFinding): number {
  const locationScore = Math.min(finding.evidence.length, 5) * 3;
  const runtimeScore = finding.tags?.some((tag) => ["production", "runtime"].includes(tag)) ? 8 : 0;
  const remediationScore = finding.remediation?.complexity === "trivial" ? 3 : 0;
  return (
    severityWeight(finding.severity) * 10 +
    confidenceWeight(finding.confidence) * 12 +
    locationScore +
    runtimeScore +
    remediationScore
  );
}

function severityWeight(severity: Severity): number {
  switch (severity) {
    case Severity.Critical:
      return 5;
    case Severity.High:
      return 4;
    case Severity.Medium:
      return 3;
    case Severity.Low:
      return 2;
    case Severity.Info:
      return 1;
  }
}

function confidenceWeight(confidence: Confidence): number {
  switch (confidence) {
    case Confidence.High:
      return 3;
    case Confidence.Medium:
      return 2;
    case Confidence.Low:
      return 1;
  }
}

function strongestSeverity(values: Severity[]): Severity {
  return (
    [...values].sort((left, right) => severityWeight(right) - severityWeight(left))[0] ??
    Severity.Info
  );
}

function strongestConfidence(values: Confidence[]): Confidence {
  return (
    [...values].sort((left, right) => confidenceWeight(right) - confidenceWeight(left))[0] ??
    Confidence.Low
  );
}

function stableId(value: string): string {
  let hash = 0;
  for (const character of value) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return `finding-${hash.toString(16).padStart(8, "0")}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort(compareStrings)
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(isNonEmptyString))].sort(compareStrings);
}

function assertObservationInit(value: ObservationInit, source: string): void {
  requireString(value.ruleId, `${source}.ruleId`);
  requireString(value.subject, `${source}.subject`);
  requireString(value.title, `${source}.title`);
  requireString(value.category, `${source}.category`);
  if (!isSeverity(value.severity)) {
    throw new Error(`${source}.severity must be one of info, low, medium, high, critical.`);
  }
  normalizeConfidence(value.confidence);
  optionalEvidence(value.location, `${source}.location`);
  optionalString(value.groupKey, `${source}.groupKey`);
  optionalStringArray(value.tags, `${source}.tags`);
}

function assertFindingInput(value: FindingInput, source: string): void {
  requireString(value.title, `${source}.title`);
  requireString(value.category, `${source}.category`);
  requireString(value.summary, `${source}.summary`);
  if (!isSeverity(value.severity)) {
    throw new Error(`${source}.severity must be one of info, low, medium, high, critical.`);
  }
  normalizeConfidence(value.confidence);
  if (!Array.isArray(value.evidence) || value.evidence.length === 0) {
    throw new Error(`${source}.evidence must contain at least one evidence item.`);
  }
  for (const [index, evidence] of value.evidence.entries()) {
    optionalEvidence(evidence, `${source}.evidence[${index}]`);
  }
  optionalString(value.id, `${source}.id`);
  optionalString(value.ruleId, `${source}.ruleId`);
  optionalString(value.groupKey, `${source}.groupKey`);
  optionalStringArray(value.tags, `${source}.tags`);
}

function assertReviewNote(value: ReviewNote, source: string): void {
  requireString(value.key, `${source}.key`);
  requireString(value.summary, `${source}.summary`);
  if (value.evidence !== undefined) {
    for (const [index, evidence] of value.evidence.entries()) {
      optionalEvidence(evidence, `${source}.evidence[${index}]`);
    }
  }
}

function assertAssessment(value: ReviewAssessment): void {
  if (!["none", "low", "medium", "high", "critical"].includes(value.risk)) {
    throw new Error("ctx.review.assessment.risk must be one of none, low, medium, high, critical.");
  }
  optionalString(value.summary, "ctx.review.assessment.summary");
}

function assertOpinion(value: ReviewOpinion): void {
  requireString(value.summary, "ctx.review.opinion.summary");
}

function optionalEvidence(value: Evidence | undefined, field: string): void {
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    throw new Error(`${field} must be an object.`);
  }
  optionalString(value.file, `${field}.file`);
  optionalPositiveInteger(value.line, `${field}.line`);
  optionalPositiveInteger(value.endLine, `${field}.endLine`);
  optionalString(value.message, `${field}.message`);
  optionalString(value.snippet, `${field}.snippet`);
}

function writeLog(level: "debug" | "info" | "warn" | "error", message: unknown): void {
  process.stderr.write(`[adversary] ${level}: ${String(message)}\n`);
}

function isVerbose(): boolean {
  return verboseValues.has(process.env.ADVERSARY_VERBOSE ?? "");
}

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

function compareNumbers(left: number | undefined, right: number | undefined): number {
  return (left ?? Number.MAX_SAFE_INTEGER) - (right ?? Number.MAX_SAFE_INTEGER);
}

function toPosixPath(path: string): string {
  return path.replaceAll("\\", "/");
}

function basename(path: string): string {
  return path.split("/").at(-1) ?? path;
}

function requireString(value: unknown, field: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} must be a non-empty string.`);
  }
}

function optionalString(value: unknown, field: string): void {
  if (value !== undefined && typeof value !== "string") {
    throw new Error(`${field} must be a string.`);
  }
}

function optionalStringArray(value: unknown, field: string): void {
  if (
    value !== undefined &&
    (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
  ) {
    throw new Error(`${field} must be an array of strings.`);
  }
}

function optionalPositiveInteger(value: unknown, field: string): void {
  if (value !== undefined && (!Number.isInteger(value) || Number(value) < 1)) {
    throw new Error(`${field} must be a positive integer.`);
  }
}

function isConfidence(value: unknown): value is Confidence {
  return value === Confidence.Low || value === Confidence.Medium || value === Confidence.High;
}

function isSeverity(value: unknown): value is Severity {
  return (
    value === Severity.Info ||
    value === Severity.Low ||
    value === Severity.Medium ||
    value === Severity.High ||
    value === Severity.Critical
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringFromUnknown(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function formatEvidenceLocation(evidence: Evidence): string {
  if (evidence.file === undefined) {
    return "";
  }
  if (evidence.line !== undefined && evidence.endLine !== undefined) {
    return `${evidence.file}:${evidence.line}-${evidence.endLine}`;
  }
  if (evidence.line !== undefined) {
    return `${evidence.file}:${evidence.line}`;
  }
  return evidence.file;
}

function formatEvidence(evidence: Evidence): string {
  const location = formatEvidenceLocation(evidence);
  if (location.length > 0 && evidence.message !== undefined) {
    return `${location} - ${evidence.message}`;
  }
  return location.length > 0 ? location : (evidence.message ?? evidence.snippet ?? "Evidence");
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as T;
}

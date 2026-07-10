import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export const DEFAULT_INPUT_PATH = "/adversary/input.json";
export const DEFAULT_OUTPUT_PATH = "/adversary/output.json";
export const ADVERSARY_RUN_PROTOCOL_VERSION = 1;
export const REVIEW_RESULT_SCHEMA_VERSION = "adversary.review.v1";

const verboseValues = new Set(["1", "true", "TRUE", "yes", "YES"]);

export const Severity = {
  Info: "info",
  Low: "low",
  Medium: "medium",
  High: "high",
  Critical: "critical",
} as const;

export type Severity = (typeof Severity)[keyof typeof Severity];

export interface SeverityGuidanceEntry {
  severity: Severity;
  guidance: string;
}

export const DEFAULT_SEVERITY_GUIDANCE: SeverityGuidanceEntry[] = [
  {
    severity: Severity.Info,
    guidance: "Interesting observations.",
  },
  {
    severity: Severity.Low,
    guidance: "Reasonable engineering improvements.",
  },
  {
    severity: Severity.Medium,
    guidance: "Issues likely to create operational problems.",
  },
  {
    severity: Severity.High,
    guidance: "Security, correctness, or reliability risks.",
  },
  {
    severity: Severity.Critical,
    guidance: "Immediate production risk.",
  },
];

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

export interface Location {
  file?: string;
  line?: number;
  endLine?: number;
}

export interface EvidenceInput extends Location {
  location?: Location;
  label?: string;
  message?: string;
  snippet?: string;
  data?: Record<string, unknown>;
  /** @deprecated Use data. */
  metadata?: Record<string, unknown>;
}

export interface Evidence {
  location?: Location;
  label?: string;
  message?: string;
  snippet?: string;
  data?: Record<string, unknown>;
}

export interface Remediation {
  complexity?: "trivial" | "small" | "medium" | "large" | "architectural";
}

export interface RecommendationInput {
  summary: string;
  details?: string;
}

export type ObservationTitle =
  | string
  | {
      singular: string;
      plural: string;
    };

export type ObservationSummary =
  | string
  | {
      singular?: string;
      grouped?: string;
    };

export type ConfidenceAggregation = "maximum" | "minimum" | "average";
export type SeverityAggregation = "highest" | "lowest";

export interface ObservationInit {
  ruleId: string;
  subject: string;
  groupKey?: string;
  groupBy?: string[];
  groupedTitle?: string;
  deduplicate?: boolean;
  category?: string;
  severity?: Severity;
  confidence?: ConfidenceInput;
  confidenceAggregation?: ConfidenceAggregation;
  severityAggregation?: SeverityAggregation;
  title: ObservationTitle;
  summary?: ObservationSummary;
  whyItMatters?: string;
  impact?: string;
  location?: EvidenceInput;
  evidence?: string | Record<string, unknown>;
  recommendation?: string | RecommendationInput;
  remediation?: Remediation;
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
  evidence: EvidenceInput[];
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
  synthesisSource?: "rule" | "generic";
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface ReviewNote {
  key: string;
  summary: string;
  evidence?: Evidence[];
  metadata?: Record<string, unknown>;
}

export interface ReviewNoteInput extends Omit<ReviewNote, "evidence"> {
  evidence?: EvidenceInput[];
}

export interface ReviewAssessment {
  risk: "none" | "low" | "medium" | "high" | "critical";
  summary?: string;
}

export interface ReviewOpinion {
  ship?: boolean;
  summary: string;
}

export interface ReviewScore {
  key: string;
  label?: string;
  score: number;
  max?: number;
  summary?: string;
}

export interface ReviewPolicy {
  minimumConfidence?: Confidence;
  maximumFindings?: number;
  includeInformational?: boolean;
  confidenceThresholds?: ConfidenceThresholds;
  severityOverrides?: Record<string, Severity>;
}

export interface ReviewResult {
  schemaVersion: typeof REVIEW_RESULT_SCHEMA_VERSION;
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
  scores?: ReviewScore[];
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

export interface AdversaryRunEnvelope {
  protocolVersion: typeof ADVERSARY_RUN_PROTOCOL_VERSION;
  result: ReviewResult;
}

export interface RuntimeInput {
  source: {
    path: string;
  };
  [key: string]: unknown;
}

export interface Summary {
  files_scanned?: number;
  [key: string]: number | string | boolean | null | undefined;
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
  review: {
    assessment: (assessment: ReviewAssessment) => void;
    positive: (note: ReviewNoteInput) => void;
    observe: (note: ReviewNoteInput) => void;
    score: (score: ReviewScore) => void;
    opinion: (opinion: ReviewOpinion) => void;
  };
}

export type RuleHandler = (context: RuleContext) => void | Promise<void>;

export interface AdversaryOptions {
  name: string;
  version?: string;
  review?: ReviewPolicy;
}

export interface RunOptions {
  input: RuntimeInput;
  review?: ReviewPolicy;
  includeSuppressed?: boolean;
  includeRawObservations?: boolean;
}

export interface EnvironmentRunOptions {
  input?: RuntimeInput;
  inputPath?: string;
  outputPath?: string;
  review?: ReviewPolicy;
  includeSuppressed?: boolean;
  includeRawObservations?: boolean;
}

export interface ReviewRenderer {
  render(result: ReviewResult): Promise<void> | void;
}

export interface RuleDefinition {
  id: string;
  category?: string;
  defaultSeverity?: Severity;
  defaultConfidence?: ConfidenceInput;
  groupBy?: string[];
  aggregate?: (observations: ReadonlyArray<ObservationInit>) => FindingSynthesis;
}

export type FindingSynthesis = Omit<Partial<ReviewFinding>, "evidence"> & {
  evidence?: EvidenceInput[];
};

export class RuleRegistry {
  private readonly rules = new Map<string, RuleDefinition>();

  register(rule: RuleDefinition): void {
    assertRuleDefinition(rule);
    if (this.rules.has(rule.id)) {
      throw new Error(`Rule definition "${rule.id}" is already registered.`);
    }
    this.rules.set(rule.id, cloneRuleDefinition(rule));
  }

  replace(rule: RuleDefinition): void {
    assertRuleDefinition(rule);
    if (!this.rules.has(rule.id)) {
      throw new Error(`Rule definition "${rule.id}" is not registered.`);
    }
    this.rules.set(rule.id, cloneRuleDefinition(rule));
  }

  lookup(ruleId: string): RuleDefinition | undefined {
    const rule = this.rules.get(ruleId);
    return rule === undefined ? undefined : cloneRuleDefinition(rule);
  }

  has(ruleId: string): boolean {
    return this.rules.has(ruleId);
  }

  snapshot(): RuleRegistry {
    const snapshot = new RuleRegistry();
    for (const rule of this.rules.values()) {
      snapshot.register(rule);
    }
    return snapshot;
  }

  importMissing(source: RuleRegistry): void {
    for (const rule of source.rules.values()) {
      if (!this.rules.has(rule.id)) {
        this.rules.set(rule.id, cloneRuleDefinition(rule));
      }
    }
  }
}

function cloneRuleDefinition(rule: RuleDefinition): RuleDefinition {
  return {
    ...rule,
    groupBy: rule.groupBy === undefined ? undefined : [...rule.groupBy],
  };
}

function cloneReviewPolicy(policy: ReviewPolicy): ReviewPolicy {
  return {
    ...policy,
    confidenceThresholds:
      policy.confidenceThresholds === undefined ? undefined : { ...policy.confidenceThresholds },
    severityOverrides:
      policy.severityOverrides === undefined ? undefined : { ...policy.severityOverrides },
  };
}

/** @deprecated Prefer app.defineRule(...) so definitions remain instance-scoped. */
export const ruleRegistry = new RuleRegistry();

/** @deprecated Prefer app.defineRule(...) so definitions remain instance-scoped. */
export function defineRule(rule: RuleDefinition): void {
  ruleRegistry.register(rule);
}

/** @deprecated Prefer app.replaceRule(...) so definitions remain instance-scoped. */
export function replaceRule(rule: RuleDefinition): void {
  ruleRegistry.replace(rule);
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

export class Adversary {
  readonly name: string;
  readonly version?: string;
  private readonly rules: Array<{ id: string; handler: RuleHandler }> = [];
  private readonly reviewPolicy: ReviewPolicy;
  private readonly ruleDefinitions: RuleRegistry;

  constructor(options: AdversaryOptions) {
    if (options.name.length === 0) {
      throw new Error("Adversary name must be a non-empty string.");
    }

    this.name = options.name;
    this.version = options.version;
    this.reviewPolicy = cloneReviewPolicy(options.review ?? {});
    this.ruleDefinitions = ruleRegistry.snapshot();
  }

  defineRule(rule: RuleDefinition): void {
    this.ruleDefinitions.register(rule);
  }

  replaceRule(rule: RuleDefinition): void {
    this.ruleDefinitions.replace(rule);
  }

  hasRuleDefinition(ruleId: string): boolean {
    return this.ruleDefinitions.has(ruleId);
  }

  rule(id: string, handler: RuleHandler): void {
    if (id.length === 0) {
      throw new Error("Rule id must be a non-empty string.");
    }

    if (this.rules.some((rule) => rule.id === id)) {
      throw new Error(`App rule "${id}" is already registered.`);
    }

    // Compatibility for definitions registered with the deprecated top-level API after
    // this Adversary was constructed. Once copied, later global changes cannot affect it.
    this.ruleDefinitions.importMissing(ruleRegistry);
    this.rules.push({ id, handler });
  }

  async run(options: RunOptions): Promise<ReviewResult> {
    const startedAt = performance.now();
    const repoPath = options.input.source.path;
    const summary: Summary = {};
    const cache = new Map<string, unknown>();
    const collector = createReviewCollector();
    const registry = this.ruleDefinitions.snapshot();
    const context = createRuleContext(repoPath, summary, cache, collector, registry);
    const includeSuppressed = options.includeSuppressed;

    for (const rule of this.rules) {
      log.debug(`running rule ${rule.id}`);
      await rule.handler(context);
    }

    const output = buildReviewResult({
      adversary: { name: this.name, version: this.version },
      repository: repoPath,
      filesScanned: typeof summary.files_scanned === "number" ? summary.files_scanned : undefined,
      collector,
      policy: cloneReviewPolicy({ ...this.reviewPolicy, ...options.review }),
      registry,
      includeSuppressed,
      includeRawObservations: options.includeRawObservations,
      timing: { totalMs: Math.round(performance.now() - startedAt) },
    });

    return output;
  }

  async runFromEnvironment(options: EnvironmentRunOptions = {}): Promise<ReviewResult> {
    const input =
      options.input ??
      (await parseInput(options.inputPath ?? process.env.ADVERSARY_INPUT ?? DEFAULT_INPUT_PATH));
    const repository = options.input
      ? input.source.path
      : (process.env.ADVERSARY_REPO ?? input.source.path);
    const result = await this.run({
      input: { ...input, source: { ...input.source, path: repository } },
      review: options.review,
      includeSuppressed:
        options.includeSuppressed ?? parseBooleanEnv(process.env.ADVERSARY_INCLUDE_SUPPRESSED),
      includeRawObservations: options.includeRawObservations,
    });
    await writeOutput(
      createAdversaryRunEnvelope(result),
      options.outputPath ?? process.env.ADVERSARY_OUTPUT ?? DEFAULT_OUTPUT_PATH,
    );
    return result;
  }
}

export function createAdversaryRunEnvelope(result: ReviewResult): AdversaryRunEnvelope {
  return {
    protocolVersion: ADVERSARY_RUN_PROTOCOL_VERSION,
    result,
  };
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
        lines.push(normalizeParagraph(result.assessment.summary), "");
      }
    }

    if (result.scores !== undefined && result.scores.length > 0) {
      lines.push("Scores", "");
      for (const score of result.scores) {
        lines.push(formatScore(score));
      }
      lines.push("");
    }

    if (result.positives.length > 0) {
      lines.push("Positive signals", "");
      for (const positive of result.positives) {
        lines.push(`- ${normalizeParagraph(positive.summary)}`);
      }
      lines.push("");
    }

    if (result.observations.length > 0) {
      lines.push("Additional observations", "");
      for (const observation of result.observations) {
        lines.push(`- ${normalizeParagraph(observation.summary)}`);
      }
      lines.push("");
    }

    const primary = result.findings[0];
    if (primary !== undefined) {
      lines.push("Primary opportunity", "");
      lines.push(`- ${primary.title.endsWith(".") ? primary.title : `${primary.title}.`}`, "");
    }

    if (result.opinion !== undefined) {
      lines.push("Overall opinion", "", normalizeParagraph(result.opinion.summary), "");
    }

    lines.push("Scan complete", "");
    if (result.target.filesScanned !== undefined) {
      lines.push(`Files scanned: ${result.target.filesScanned}`);
    }
    lines.push(`Findings: ${result.findings.length}`, "");

    for (const finding of result.findings) {
      lines.push(`[${finding.severity}] ${finding.title}`);
      const firstEvidence = finding.evidence.find((item) => item.location?.file !== undefined);
      if (firstEvidence?.location?.file !== undefined) {
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
          lines.push(...formatEvidenceLines(evidence));
        }
        lines.push("");
      }

      if (finding.recommendation !== undefined) {
        lines.push("Recommendation", "", normalizeParagraph(finding.recommendation), "");
      }
    }

    this.write(`${lines.join("\n").trimEnd()}\n`);
  }
}

function createRuleContext(
  repoPath: string,
  summary: Summary,
  cache: Map<string, unknown>,
  collector: ReviewCollector,
  registry: RuleRegistry,
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
      assertObservationInit(observation, "ctx.observe", registry);
      collector.observations.push(observation);
    },
    finding(finding: FindingInput): void {
      assertFindingInput(finding, "ctx.finding");
      collector.findings.push({
        finding: normalizeFindingInput(finding, collector.findings.length),
        deduplicate: finding.deduplicate !== false,
      });
    },
    review: {
      assessment(assessment: ReviewAssessment): void {
        assertAssessment(assessment);
        collector.assessment = assessment;
      },
      positive(note: ReviewNoteInput): void {
        assertReviewNote(note, "ctx.review.positive");
        collector.positives.push(normalizeReviewNote(note));
      },
      observe(note: ReviewNoteInput): void {
        assertReviewNote(note, "ctx.review.observe");
        collector.reviewObservations.push(normalizeReviewNote(note));
      },
      score(score: ReviewScore): void {
        assertReviewScore(score);
        collector.scores.push(score);
      },
      opinion(opinion: ReviewOpinion): void {
        assertOpinion(opinion);
        collector.opinion = opinion;
      },
    },
  };
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

interface ReviewCollector {
  observations: ObservationInit[];
  findings: CollectedFinding[];
  assessment?: ReviewAssessment;
  positives: ReviewNote[];
  reviewObservations: ReviewNote[];
  scores: ReviewScore[];
  opinion?: ReviewOpinion;
}

interface CollectedFinding {
  finding: ReviewFinding;
  deduplicate: boolean;
}

function createReviewCollector(): ReviewCollector {
  return {
    observations: [],
    findings: [],
    positives: [],
    reviewObservations: [],
    scores: [],
  };
}

function buildReviewResult(input: {
  adversary: ReviewResult["adversary"];
  repository: string;
  filesScanned?: number;
  collector: ReviewCollector;
  policy: ReviewPolicy;
  registry: RuleRegistry;
  includeSuppressed?: boolean;
  includeRawObservations?: boolean;
  timing?: ReviewResult["timing"];
}): ReviewResult {
  const thresholds = input.policy.confidenceThresholds ?? DEFAULT_CONFIDENCE_THRESHOLDS;
  const synthesized = synthesizeObservationFindings(
    input.collector.observations,
    thresholds,
    input.registry,
  );
  const allFindings = deduplicateFindings([
    ...synthesized.map((finding) => ({ finding, deduplicate: true })),
    ...input.collector.findings,
  ]).map((finding) => calibrateFindingSeverity(finding, input.policy));
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

  const positives = selectPositiveSignals(input.collector.positives);
  const reviewObservations = deduplicateReviewObservations(
    input.collector.reviewObservations,
    positives,
  );

  return omitUndefined({
    schemaVersion: REVIEW_RESULT_SCHEMA_VERSION,
    adversary: input.adversary,
    target: omitUndefined({
      repository: input.repository,
      filesScanned: input.filesScanned,
    }),
    assessment: input.collector.assessment ?? synthesizeAssessment(eligible, positives),
    positives,
    observations: reviewObservations,
    scores:
      input.collector.scores.length > 0 ? deduplicateScores(input.collector.scores) : undefined,
    findings: eligible,
    opinion: input.collector.opinion ?? synthesizeOpinion(eligible),
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
  registry: RuleRegistry,
): ReviewFinding[] {
  const grouped = new Map<string, ObservationInit[]>();
  const seen = new Set<string>();

  for (const observation of observations) {
    const rule = registry.lookup(observation.ruleId);
    const groupKey = observation.groupKey ?? defaultObservationGroupKey(observation, rule);
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

    const rule = registry.lookup(first.ruleId);
    const synthesis = rule?.aggregate?.(group) ?? {};
    const synthesisSource = rule?.aggregate === undefined ? "generic" : "rule";
    log.debug(
      `review synthesis ruleId=${first.ruleId} groupKey=${groupKey} observations=${group.length} selected=${synthesisSource} fallback=${synthesisSource === "generic"}`,
    );

    const evidence = deduplicateEvidence(synthesis.evidence ?? group.map(observationToEvidence));
    const recommendation =
      synthesis.recommendation === undefined
        ? synthesizeRecommendation(group)
        : normalizeParagraph(synthesis.recommendation);
    const confidence = aggregateConfidence(
      group.map((observation) =>
        normalizeConfidence(
          observation.confidence ?? rule?.defaultConfidence ?? Confidence.Medium,
          thresholds,
        ),
      ),
      first.confidenceAggregation ?? "maximum",
    );
    const severity = aggregateSeverity(
      group.map((observation) => observation.severity ?? rule?.defaultSeverity ?? Severity.Info),
      first.severityAggregation ?? "highest",
    );

    return {
      id: synthesis.id ?? stableId(`${first.ruleId}:${groupKey}`),
      ruleId: synthesis.ruleId ?? first.ruleId,
      groupKey: synthesis.groupKey ?? groupKey,
      title:
        synthesis.title ??
        synthesizeObservationTitle(first.title, group.length, first.groupedTitle),
      category: synthesis.category ?? first.category ?? rule?.category ?? "general",
      severity: synthesis.severity ?? severity,
      confidence:
        synthesis.confidence ??
        (rule?.defaultConfidence === undefined
          ? confidence
          : normalizeConfidence(rule.defaultConfidence, thresholds)),
      summary: synthesis.summary ?? summarizeObservationGroup(group),
      whyItMatters: synthesis.whyItMatters ?? first.whyItMatters,
      impact: synthesis.impact ?? first.impact,
      evidence,
      recommendation: recommendation.length > 0 ? recommendation : undefined,
      remediation: synthesis.remediation ?? first.remediation,
      synthesisSource,
      tags: synthesis.tags ?? uniqueStrings(group.flatMap((observation) => observation.tags ?? [])),
      metadata: synthesis.metadata ?? first.metadata,
    };
  });
}

function normalizeFindingInput(input: FindingInput, occurrence = 0): ReviewFinding {
  return omitUndefined({
    id:
      input.id ??
      stableId(
        `${input.ruleId ?? input.title}:${input.groupKey ?? input.category}${
          input.deduplicate === false ? `:${occurrence}` : ""
        }`,
      ),
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
    recommendation:
      input.recommendation === undefined ? undefined : normalizeParagraph(input.recommendation),
    remediation: input.remediation,
    tags: input.tags === undefined ? undefined : uniqueStrings(input.tags),
    metadata: input.metadata,
  }) as ReviewFinding;
}

function deduplicateFindings(findings: CollectedFinding[]): ReviewFinding[] {
  const seen = new Set<string>();
  const result: ReviewFinding[] = [];

  for (const collected of findings) {
    const { finding } = collected;
    if (!collected.deduplicate) {
      result.push({ ...finding, evidence: deduplicateEvidence(finding.evidence) });
      continue;
    }
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

function deduplicateEvidence(evidence: ReadonlyArray<EvidenceInput | Evidence>): Evidence[] {
  const seen = new Set<string>();
  const result: Evidence[] = [];

  for (const item of evidence) {
    const normalized = normalizeEvidence(item);
    const key = stableStringify(normalized);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(normalized);
    }
  }

  return result.sort((left, right) => {
    const fileComparison = compareStrings(left.location?.file ?? "", right.location?.file ?? "");
    if (fileComparison !== 0) {
      return fileComparison;
    }
    const lineComparison = compareNumbers(left.location?.line, right.location?.line);
    if (lineComparison !== 0) {
      return lineComparison;
    }
    return compareStrings(left.message ?? "", right.message ?? "");
  });
}

function normalizeEvidence(input: EvidenceInput | Evidence): Evidence {
  const legacy = input as EvidenceInput;
  const location =
    legacy.location ??
    (legacy.file !== undefined || legacy.line !== undefined || legacy.endLine !== undefined
      ? omitUndefined({ file: legacy.file, line: legacy.line, endLine: legacy.endLine })
      : undefined);
  return omitUndefined({
    location,
    label: input.label,
    message: input.message,
    snippet: input.snippet,
    data: input.data ?? legacy.metadata,
  });
}

function normalizeReviewNote(note: ReviewNoteInput): ReviewNote {
  return omitUndefined({
    ...note,
    evidence: note.evidence === undefined ? undefined : deduplicateEvidence(note.evidence),
  }) as ReviewNote;
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

function selectPositiveSignals(notes: ReviewNote[]): ReviewNote[] {
  const selected: ReviewNote[] = [];
  const seen = new Set<string>();

  // Registration order expresses the review author's priority. Two strong signals
  // provide useful context without diluting the findings.
  for (const note of notes) {
    if (!seen.has(note.key)) {
      seen.add(note.key);
      selected.push(note);
    }
    if (selected.length === 2) {
      break;
    }
  }

  return deduplicateNotes(selected);
}

function deduplicateReviewObservations(
  observations: ReviewNote[],
  positives: ReviewNote[],
): ReviewNote[] {
  const deduped = deduplicateNotes(observations);

  return deduped.filter((item) => {
    return !positives.some((positive) => notesDescribeSameFact(positive, item));
  });
}

function notesDescribeSameFact(positive: ReviewNote, observation: ReviewNote): boolean {
  if (positive.key === observation.key) {
    return true;
  }

  const positiveText = normalizeSemanticText(`${positive.key} ${positive.summary}`);
  const observationText = normalizeSemanticText(`${observation.key} ${observation.summary}`);
  return positiveText.length > 0 && positiveText === observationText;
}

function synthesizeAssessment(
  findings: ReviewFinding[],
  positives: ReviewNote[] = [],
): ReviewAssessment {
  const strength = assessmentStrength(positives[0]);

  if (findings.length === 0) {
    return {
      risk: "none",
      summary: joinSentences(
        strength,
        "No material concerns were identified in the reviewed repository.",
      ),
    };
  }

  const risk = highestRisk(findings);
  const primary = findings[0];
  const primaryConcern =
    primary === undefined ? "the highest-ranked finding" : assessmentConcern(primary);

  if (findings.length === 1) {
    return {
      risk,
      summary: joinSentences(
        strength,
        `The only material concern identified is ${primaryConcern}.`,
      ),
    };
  }

  return {
    risk,
    summary: joinSentences(
      strength,
      `${numberWord(findings.length)} material concerns were identified. The highest-value improvement is ${primaryConcern}.`,
    ),
  };
}

function assessmentStrength(positive: ReviewNote | undefined): string | undefined {
  if (positive === undefined) {
    return undefined;
  }

  const summary = normalizeParagraph(positive.summary);
  if (/^uses\b/i.test(summary)) {
    return `The repository ${lowercaseFirst(summary)}`;
  }
  return summary;
}

function assessmentConcern(finding: ReviewFinding): string {
  const summary = normalizeParagraph(finding.summary).split(/(?<=[.!?])\s+/, 1)[0];
  return concernClause(
    lowercaseFirst(trimTrailingSentencePunctuation(summary ?? findingConcern(finding))),
  );
}

function concernClause(concern: string): string {
  const isClause =
    /\b(?:allows|are|builds|can|contains|copies|could|did|do|does|exposes|has|have|includes|installs|is|lacks|may|might|must|reads|references|relies|requires|runs|uses|was|were|writes)\b/i.test(
      concern,
    );
  if (!isClause) {
    return concern;
  }

  const hasDeterminer = /^(?:a|an|any|each|its|no|one|some|the|their|these|this|those)\b/i.test(
    concern,
  );
  return `that ${hasDeterminer ? concern : `the ${concern}`}`;
}

function joinSentences(...sentences: Array<string | undefined>): string {
  return sentences.filter(isNonEmptyString).join(" ");
}

function synthesizeOpinion(findings: ReviewFinding[]): ReviewOpinion | undefined {
  if (findings.length === 0) {
    return {
      ship: true,
      summary: "I would ship this as-is.",
    };
  }

  const highestSeverity = highestFindingSeverity(findings);
  const ship = severityWeight(highestSeverity) < severityWeight(Severity.High);

  if (findings.length > 1) {
    return {
      ship,
      summary: "I would address the remaining findings before production.",
    };
  }

  const finding = findings[0];
  const improvement = finding === undefined ? "Addressing the finding" : improvementPhrase(finding);
  return {
    ship,
    summary: ship
      ? `I would ship this as-is. ${improvement} is the only improvement I would recommend before production.`
      : `${improvement} is the most important improvement to address before production.`,
  };
}

function deduplicateScores(scores: ReviewScore[]): ReviewScore[] {
  const seen = new Set<string>();
  const result: ReviewScore[] = [];

  for (const score of scores) {
    if (!seen.has(score.key)) {
      seen.add(score.key);
      result.push(score);
    }
  }

  return result.sort((left, right) => compareStrings(left.key, right.key));
}

function observationToEvidence(observation: ObservationInit): Evidence {
  const data = isRecord(observation.evidence)
    ? observation.evidence
    : observation.evidence === undefined
      ? undefined
      : { evidence: observation.evidence };
  const message = isRecord(observation.evidence)
    ? structuredEvidenceMessage(observation.evidence)
    : stringFromUnknown(observation.evidence);
  const snippet = isRecord(observation.evidence)
    ? (stringFromUnknown(observation.evidence.snippet) ??
      stringFromUnknown(observation.evidence.instruction))
    : observation.location?.snippet;

  return omitUndefined({
    location: normalizeEvidence(observation.location ?? {}).location,
    label: observation.location?.label ?? message,
    message: observation.location?.message ?? message,
    snippet,
    data,
  });
}

function structuredEvidenceMessage(evidence: Record<string, unknown>): string | undefined {
  const explicitMessage = stringFromUnknown(evidence.message);
  if (explicitMessage !== undefined) {
    return explicitMessage;
  }

  const label = stringFromUnknown(evidence.label) ?? stringFromUnknown(evidence.name);
  if (label !== undefined) {
    return label;
  }

  return stringFromUnknown(evidence.summary) ?? stringFromUnknown(evidence.instruction);
}

function synthesizeObservationTitle(
  title: ObservationTitle,
  count: number,
  groupedTitle: string | undefined,
): string {
  if (typeof title === "string") {
    return count > 1 && groupedTitle !== undefined ? groupedTitle : title;
  }
  return count > 1 ? title.plural : title.singular;
}

function summarizeObservationGroup(group: ObservationInit[]): string {
  const first = group[0];
  if (first === undefined) {
    throw new Error("Cannot summarize an empty observation group.");
  }

  if (first.summary !== undefined) {
    if (typeof first.summary === "string") {
      return normalizeParagraph(renderObservationTemplate(first.summary, group));
    }
    const template = group.length > 1 ? first.summary.grouped : first.summary.singular;
    if (template !== undefined) {
      return normalizeParagraph(renderObservationTemplate(template, group));
    }
  }

  const recommendation =
    typeof first.recommendation === "string" ? undefined : first.recommendation?.summary;
  if (group.length === 1) {
    return recommendation ?? synthesizeObservationTitle(first.title, 1, first.groupedTitle);
  }
  return `${group.length} related observations were reported for ${first.subject}.`;
}

function synthesizeRecommendation(group: ObservationInit[]): string {
  const recommendations = uniqueStrings(
    group.flatMap((observation) => {
      if (typeof observation.recommendation === "string") {
        return [observation.recommendation];
      }
      if (observation.recommendation !== undefined) {
        return [
          joinRecommendation(
            observation.recommendation.summary,
            observation.recommendation.details,
          ),
        ];
      }
      return [];
    }),
  );

  return recommendations.map(normalizeParagraph).join("\n\n");
}

function joinRecommendation(summary: string, details: string | undefined): string {
  if (!isNonEmptyString(details)) {
    return summary;
  }

  const compactSummary = trimTrailingSentencePunctuation(summary);
  const compactDetails = trimTrailingSentencePunctuation(details);

  if (/^use\s+/i.test(compactDetails)) {
    return `${compactSummary} and ${lowercaseFirst(compactDetails)}.`;
  }

  return `${compactSummary}. ${compactDetails}.`;
}

function defaultObservationGroupKey(
  observation: ObservationInit,
  rule: RuleDefinition | undefined,
): string {
  const groupBy = observation.groupBy ?? rule?.groupBy;
  if (groupBy !== undefined && groupBy.length > 0) {
    return groupBy
      .map((field) => `${field}:${stringFromUnknown(observationValue(observation, field)) ?? ""}`)
      .join("|");
  }
  return `${observation.ruleId}:${observation.subject}:${observation.category ?? rule?.category ?? "general"}`;
}

function renderObservationTemplate(template: string, group: ObservationInit[]): string {
  const values = observationTemplateValues(group);
  return template.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (match, key: string) => {
    return values[key] ?? match;
  });
}

function observationTemplateValues(group: ObservationInit[]): Record<string, string> {
  const first = group[0];
  const subjects = uniqueStrings(group.map((observation) => observation.subject));
  const locations = uniqueStrings(group.map(formatObservationLocation).filter(isNonEmptyString));

  return omitUndefined({
    count: numberWord(group.length),
    location: locations[0],
    locations: joinHumanList(locations),
    subject: first?.subject,
    subjects: joinHumanList(subjects),
  });
}

function observationValue(observation: ObservationInit, field: string): unknown {
  if (field.includes(".")) {
    return field.split(".").reduce<unknown>((value, part) => {
      return isRecord(value) ? value[part] : undefined;
    }, observation);
  }
  return (observation as unknown as Record<string, unknown>)[field];
}

function formatObservationLocation(observation: ObservationInit): string | undefined {
  if (observation.location?.file === undefined) {
    return undefined;
  }
  if (observation.location.line === undefined) {
    return observation.location.file;
  }
  return `${observation.location.file}:${observation.location.line}`;
}

function joinHumanList(values: string[]): string {
  if (values.length <= 2) {
    return values.join(" and ");
  }
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

function highestRisk(findings: ReviewFinding[]): ReviewAssessment["risk"] {
  const severity = highestFindingSeverity(findings);
  if (severity === Severity.Info) {
    return "none";
  }
  return severity;
}

function highestFindingSeverity(findings: ReviewFinding[]): Severity {
  return aggregateSeverity(
    findings.map((finding) => finding.severity),
    "highest",
  );
}

function findingConcern(finding: ReviewFinding): string {
  return lowercaseFirst(trimTrailingSentencePunctuation(finding.title));
}

function improvementPhrase(finding: ReviewFinding): string {
  const recommendation = recommendationSubject(finding.recommendation);
  if (recommendation !== undefined) {
    return recommendation;
  }

  return `Addressing ${findingConcern(finding)}`;
}

function recommendationSubject(recommendation: string | undefined): string | undefined {
  if (recommendation === undefined) {
    return undefined;
  }

  const normalized = trimTrailingSentencePunctuation(normalizeParagraph(recommendation));
  const firstClause = normalized.split(/\s+(?:and|when|where|with)\s+/i)[0]?.trim();
  if (!isNonEmptyString(firstClause)) {
    return undefined;
  }

  return gerundPhrase(firstClause);
}

function gerundPhrase(phrase: string): string {
  const words = phrase.split(/\s+/);
  const first = words[0];
  if (first === undefined) {
    return phrase;
  }

  return capitalize([toGerund(first), ...words.slice(1)].join(" "));
}

function toGerund(verb: string): string {
  const lower = verb.toLowerCase();
  const irregular: Record<string, string> = {
    pin: "pinning",
    run: "running",
    use: "using",
  };
  const known = irregular[lower];
  if (known !== undefined) {
    return known;
  }
  if (lower.endsWith("e") && !lower.endsWith("ee")) {
    return `${lower.slice(0, -1)}ing`;
  }
  return `${lower}ing`;
}

function normalizeSemanticText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 0 && !semanticStopWords.has(word))
    .join(" ");
}

function trimTrailingWord(value: string | undefined, word: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const pattern = new RegExp(`\\s+${word}$`, "i");
  const trimmed = value.replace(pattern, "").trim();
  return trimmed.length > 0 ? trimmed : value;
}

function numberWord(value: number): string {
  return (
    {
      1: "One",
      2: "Two",
      3: "Three",
      4: "Four",
      5: "Five",
      6: "Six",
      7: "Seven",
      8: "Eight",
      9: "Nine",
      10: "Ten",
    }[value] ?? String(value)
  );
}

function calibrateFindingSeverity(finding: ReviewFinding, policy: ReviewPolicy): ReviewFinding {
  const override =
    policy.severityOverrides?.[finding.ruleId ?? ""] ??
    policy.severityOverrides?.[finding.groupKey ?? ""];

  return override === undefined ? finding : { ...finding, severity: override };
}

function scoreFinding(finding: ReviewFinding): number {
  const locationScore = Math.min(finding.evidence.length, 5) * 3;
  const remediationScore = finding.remediation?.complexity === "trivial" ? 3 : 0;
  return (
    severityWeight(finding.severity) * 10 +
    confidenceWeight(finding.confidence) * 12 +
    locationScore +
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

function aggregateSeverity(values: Severity[], strategy: SeverityAggregation): Severity {
  const sorted = [...values].sort((left, right) => severityWeight(right) - severityWeight(left));
  if (strategy === "lowest") {
    return sorted.at(-1) ?? Severity.Info;
  }
  return sorted[0] ?? Severity.Info;
}

function aggregateConfidence(values: Confidence[], strategy: ConfidenceAggregation): Confidence {
  if (values.length === 0) {
    return Confidence.Low;
  }

  if (strategy === "minimum") {
    return (
      [...values].sort((left, right) => confidenceWeight(left) - confidenceWeight(right))[0] ??
      Confidence.Low
    );
  }

  if (strategy === "average") {
    const average =
      values.reduce((total, confidence) => total + confidenceNumericValue(confidence), 0) /
      values.length;
    return normalizeConfidence(average);
  }

  return (
    [...values].sort((left, right) => confidenceWeight(right) - confidenceWeight(left))[0] ??
    Confidence.Low
  );
}

function confidenceNumericValue(confidence: Confidence): number {
  switch (confidence) {
    case Confidence.High:
      return 0.95;
    case Confidence.Medium:
      return 0.72;
    case Confidence.Low:
      return 0.3;
  }
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

function assertObservationInit(
  value: ObservationInit,
  source: string,
  registry: RuleRegistry,
): void {
  requireString(value.ruleId, `${source}.ruleId`);
  requireString(value.subject, `${source}.subject`);
  requireObservationTitle(value.title, `${source}.title`);
  const rule = registry.lookup(value.ruleId);
  if (value.category === undefined && rule?.category === undefined) {
    throw new Error(`${source}.category is required when rule.category is not defined.`);
  }
  optionalString(value.category, `${source}.category`);
  if (value.severity === undefined && rule?.defaultSeverity === undefined) {
    throw new Error(`${source}.severity is required when rule.defaultSeverity is not defined.`);
  }
  if (value.severity !== undefined && !isSeverity(value.severity)) {
    throw new Error(`${source}.severity must be one of info, low, medium, high, critical.`);
  }
  const ruleConfidence = rule?.defaultConfidence;
  if (value.confidence === undefined && ruleConfidence === undefined) {
    throw new Error(`${source}.confidence is required when rule.defaultConfidence is not defined.`);
  }
  if (value.confidence !== undefined) {
    normalizeConfidence(value.confidence);
  }
  optionalObservationSummary(value.summary, `${source}.summary`);
  optionalEvidence(value.location, `${source}.location`);
  optionalString(value.groupKey, `${source}.groupKey`);
  optionalStringArray(value.groupBy, `${source}.groupBy`);
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

function assertReviewNote(value: ReviewNoteInput, source: string): void {
  requireString(value.key, `${source}.key`);
  requireString(value.summary, `${source}.summary`);
  if (value.evidence !== undefined) {
    for (const [index, evidence] of value.evidence.entries()) {
      optionalEvidence(evidence, `${source}.evidence[${index}]`);
    }
  }
}

function assertReviewScore(value: ReviewScore): void {
  requireString(value.key, "ctx.review.score.key");
  if (typeof value.score !== "number" || Number.isNaN(value.score)) {
    throw new Error("ctx.review.score.score must be a number.");
  }
  if (value.max !== undefined && (typeof value.max !== "number" || Number.isNaN(value.max))) {
    throw new Error("ctx.review.score.max must be a number.");
  }
  optionalString(value.label, "ctx.review.score.label");
  optionalString(value.summary, "ctx.review.score.summary");
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

function assertRuleDefinition(rule: RuleDefinition): void {
  requireString(rule.id, "rule.id");
  optionalString(rule.category, "rule.category");
  if (rule.defaultSeverity !== undefined && !isSeverity(rule.defaultSeverity)) {
    throw new Error("rule.defaultSeverity must be one of info, low, medium, high, critical.");
  }
  if (rule.defaultConfidence !== undefined) {
    normalizeConfidence(rule.defaultConfidence);
  }
  optionalStringArray(rule.groupBy, "rule.groupBy");
  if (rule.aggregate !== undefined && typeof rule.aggregate !== "function") {
    throw new Error("rule.aggregate must be a function.");
  }
}

function requireObservationTitle(value: ObservationTitle, field: string): void {
  if (typeof value === "string") {
    requireString(value, field);
    return;
  }
  if (!isRecord(value)) {
    throw new Error(`${field} must be a string or { singular, plural }.`);
  }
  requireString(value.singular, `${field}.singular`);
  requireString(value.plural, `${field}.plural`);
}

function optionalObservationSummary(value: ObservationSummary | undefined, field: string): void {
  if (value === undefined) {
    return;
  }
  if (typeof value === "string") {
    optionalString(value, field);
    return;
  }
  if (!isRecord(value)) {
    throw new Error(`${field} must be a string or { singular, grouped }.`);
  }
  optionalString(value.singular, `${field}.singular`);
  optionalString(value.grouped, `${field}.grouped`);
}

function optionalEvidence(value: EvidenceInput | Evidence | undefined, field: string): void {
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    throw new Error(`${field} must be an object.`);
  }
  const input = value as EvidenceInput;
  optionalString(input.file, `${field}.file`);
  optionalPositiveInteger(input.line, `${field}.line`);
  optionalPositiveInteger(input.endLine, `${field}.endLine`);
  optionalString(value.message, `${field}.message`);
  optionalString(value.snippet, `${field}.snippet`);
  optionalString(value.label, `${field}.label`);
  if (value.location !== undefined) {
    if (!isRecord(value.location)) {
      throw new Error(`${field}.location must be an object.`);
    }
    optionalString(value.location.file, `${field}.location.file`);
    optionalPositiveInteger(value.location.line, `${field}.location.line`);
    optionalPositiveInteger(value.location.endLine, `${field}.location.endLine`);
  }
}

function writeLog(level: "debug" | "info" | "warn" | "error", message: unknown): void {
  process.stderr.write(`[adversary] ${level}: ${String(message)}\n`);
}

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (value === undefined || value.length === 0) {
    return undefined;
  }
  return ["1", "true", "TRUE", "yes", "YES"].includes(value);
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

const semanticStopWords = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "from",
  "in",
  "is",
  "of",
  "the",
  "to",
  "uses",
  "using",
]);

function formatEvidenceLocation(evidence: Evidence): string {
  const file = evidence.location?.file;
  const line = evidence.location?.line;
  const endLine = evidence.location?.endLine;

  if (file === undefined) {
    return "";
  }
  if (line !== undefined && endLine !== undefined) {
    return `${file}:${line}-${endLine}`;
  }
  if (line !== undefined) {
    return `${file}:${line}`;
  }
  return file;
}

function formatEvidenceLines(evidence: Evidence): string[] {
  const location = formatEvidenceLocation(evidence);
  const label = evidence.label ?? evidence.message;
  const firstLine =
    location.length > 0 && label !== undefined
      ? `- ${location} — ${label}`
      : `- ${location.length > 0 ? location : (label ?? "Evidence")}`;
  const lines = [firstLine];

  if (evidence.snippet !== undefined) {
    lines.push(`  ${evidence.snippet}`);
  }

  return lines;
}

function formatScore(score: ReviewScore): string {
  const label = score.label ?? score.key;
  const max = score.max ?? 10;
  const summary = score.summary === undefined ? "" : ` - ${normalizeParagraph(score.summary)}`;
  return `${label}: ${score.score} / ${max}${summary}`;
}

function normalizeParagraph(value: string): string {
  return value
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(" ");
}

function trimTrailingSentencePunctuation(value: string): string {
  return value.trim().replace(/[.!?]+$/g, "");
}

function lowercaseFirst(value: string): string {
  return `${value.slice(0, 1).toLowerCase()}${value.slice(1)}`;
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as T;
}

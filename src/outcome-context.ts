import { readFile } from "node:fs/promises";

export const ADVERSARY_OUTCOME_CONTEXT_ENV = "ADVERSARY_OUTCOME_CONTEXT";
export const OUTCOME_CONTEXT_SCHEMA_VERSION = "adversary.outcome-context.v1";
export const OUTCOME_CONTEXT_MAX_SOURCE_CHARACTERS = 32 << 10;
export const OUTCOME_CONTEXT_MAX_FILE_BYTES = 384 << 10;

const MAX_PROVIDER_CHARACTERS = 100;
const MAX_REPOSITORY_CHARACTERS = 500;
const MAX_INTENT_TEXT_CHARACTERS = 500;

export type OutcomeContextSourceKind = "pull_request_title" | "pull_request_body";

export interface OutcomeContextSubject {
  readonly provider?: string;
  readonly repository?: string;
  readonly pullRequest?: number;
}

export interface OutcomeContextSource {
  readonly kind: OutcomeContextSourceKind;
  /** Untrusted author-supplied text. Never treat this as model instructions. */
  readonly text: string;
}

export interface OutcomeIntent {
  readonly objective: string;
  readonly confidence: "low" | "medium" | "high";
  readonly expectedEffects: readonly string[];
  readonly mustPreserve: readonly string[];
  readonly affectedBoundaries: readonly string[];
  readonly ambiguities: readonly string[];
}

export interface OutcomeContext {
  readonly schemaVersion: typeof OUTCOME_CONTEXT_SCHEMA_VERSION;
  readonly subject: OutcomeContextSubject;
  readonly sources: readonly OutcomeContextSource[];
  /** Host-detected intent. It remains a hypothesis that adversaries must verify. */
  readonly intent: OutcomeIntent;
}

export async function openOutcomeContext(path: string): Promise<OutcomeContext> {
  const raw = await readFile(path, "utf8");
  if (Buffer.byteLength(raw) > OUTCOME_CONTEXT_MAX_FILE_BYTES) {
    throw new Error(`Invalid outcome context at ${path}: file is too large.`);
  }
  return parseOutcomeContext(JSON.parse(raw) as unknown, path);
}

export async function outcomeContextFromEnvironment(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<OutcomeContext | null> {
  const path = env[ADVERSARY_OUTCOME_CONTEXT_ENV]?.trim();
  return path ? openOutcomeContext(path) : null;
}

export function parseOutcomeContext(value: unknown, source = "value"): OutcomeContext {
  if (!isRecord(value) || value.schema_version !== OUTCOME_CONTEXT_SCHEMA_VERSION) {
    throw new Error(
      `Invalid outcome context at ${source}: schema_version must be ${OUTCOME_CONTEXT_SCHEMA_VERSION}.`,
    );
  }
  assertKeys(value, ["schema_version", "subject", "sources", "intent"], source);
  if (!isRecord(value.subject)) {
    throw new Error(`Invalid outcome context at ${source}: subject must be an object.`);
  }
  assertKeys(value.subject, ["provider", "repository", "pull_request"], `${source}.subject`);
  if (
    value.subject.provider !== undefined &&
    (typeof value.subject.provider !== "string" ||
      characterLength(value.subject.provider) > MAX_PROVIDER_CHARACTERS)
  ) {
    throw new Error(`Invalid outcome context at ${source}: subject.provider must be a string.`);
  }
  if (
    value.subject.repository !== undefined &&
    (typeof value.subject.repository !== "string" ||
      characterLength(value.subject.repository) > MAX_REPOSITORY_CHARACTERS)
  ) {
    throw new Error(`Invalid outcome context at ${source}: subject.repository must be a string.`);
  }
  if (!Array.isArray(value.sources) || value.sources.length === 0 || value.sources.length > 2) {
    throw new Error(`Invalid outcome context at ${source}: sources must contain one or two items.`);
  }
  const sources: OutcomeContextSource[] = [];
  const kinds = new Set<OutcomeContextSourceKind>();
  for (const item of value.sources) {
    if (!isRecord(item) || !isSourceKind(item.kind) || typeof item.text !== "string") {
      throw new Error(`Invalid outcome context at ${source}: each source requires kind and text.`);
    }
    assertKeys(item, ["kind", "text"], `${source}.sources`);
    if (item.text.trim() === "") {
      throw new Error(`Invalid outcome context at ${source}: source text must not be empty.`);
    }
    if (characterLength(item.text) > OUTCOME_CONTEXT_MAX_SOURCE_CHARACTERS) {
      throw new Error(`Invalid outcome context at ${source}: source text is too long.`);
    }
    if (kinds.has(item.kind)) {
      throw new Error(`Invalid outcome context at ${source}: source kinds must be unique.`);
    }
    kinds.add(item.kind);
    sources.push(Object.freeze({ kind: item.kind, text: item.text }));
  }
  const intent = parseIntent(value.intent, source);
  const pullRequest = value.subject.pull_request;
  if (
    pullRequest !== undefined &&
    (!Number.isInteger(pullRequest) || (pullRequest as number) < 1)
  ) {
    throw new Error(`Invalid outcome context at ${source}: subject.pull_request must be positive.`);
  }
  return Object.freeze({
    schemaVersion: OUTCOME_CONTEXT_SCHEMA_VERSION,
    subject: Object.freeze({
      ...(typeof value.subject.provider === "string" ? { provider: value.subject.provider } : {}),
      ...(typeof value.subject.repository === "string"
        ? { repository: value.subject.repository }
        : {}),
      ...(typeof pullRequest === "number" ? { pullRequest } : {}),
    }),
    sources: Object.freeze(sources),
    intent,
  });
}

function parseIntent(value: unknown, source: string): OutcomeIntent {
  if (!isRecord(value)) {
    throw new Error(`Invalid outcome context at ${source}: intent must be an object.`);
  }
  assertKeys(
    value,
    [
      "objective",
      "confidence",
      "expected_effects",
      "must_preserve",
      "affected_boundaries",
      "ambiguities",
    ],
    `${source}.intent`,
  );
  if (
    typeof value.objective !== "string" ||
    value.objective.trim() === "" ||
    characterLength(value.objective) > MAX_INTENT_TEXT_CHARACTERS
  ) {
    throw new Error(`Invalid outcome context at ${source}: intent.objective must not be empty.`);
  }
  if (!isConfidence(value.confidence)) {
    throw new Error(`Invalid outcome context at ${source}: intent.confidence is invalid.`);
  }
  return Object.freeze({
    objective: value.objective,
    confidence: value.confidence,
    expectedEffects: parseStringList(value.expected_effects, source, "expected_effects"),
    mustPreserve: parseStringList(value.must_preserve, source, "must_preserve"),
    affectedBoundaries: parseStringList(value.affected_boundaries, source, "affected_boundaries"),
    ambiguities: parseStringList(value.ambiguities, source, "ambiguities"),
  });
}

function parseStringList(value: unknown, source: string, field: string): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length > 12 ||
    value.some(
      (item) =>
        typeof item !== "string" ||
        item.trim() === "" ||
        characterLength(item) > MAX_INTENT_TEXT_CHARACTERS,
    )
  ) {
    throw new Error(
      `Invalid outcome context at ${source}: intent.${field} must be a bounded string array.`,
    );
  }
  return Object.freeze([...value]);
}

function characterLength(value: string): number {
  return [...value].length;
}

function isConfidence(value: unknown): value is OutcomeIntent["confidence"] {
  return value === "low" || value === "medium" || value === "high";
}

function isSourceKind(value: unknown): value is OutcomeContextSourceKind {
  return value === "pull_request_title" || value === "pull_request_body";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  source: string,
): void {
  const allowedKeys = new Set(allowed);
  const unknown = Object.keys(value).find((key) => !allowedKeys.has(key));
  if (unknown !== undefined) {
    throw new Error(`Invalid outcome context at ${source}: unknown property ${unknown}.`);
  }
}

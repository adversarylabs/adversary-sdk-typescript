import { readFile } from "node:fs/promises";

export const ADVERSARY_OUTCOME_CONTEXT_ENV = "ADVERSARY_OUTCOME_CONTEXT";
export const OUTCOME_CONTEXT_SCHEMA_VERSION = "adversary.outcome-context.v1";
export const OUTCOME_CONTEXT_MAX_TEXT_BYTES = 64 << 10;

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

export interface OutcomeContext {
  readonly schemaVersion: typeof OUTCOME_CONTEXT_SCHEMA_VERSION;
  readonly subject: OutcomeContextSubject;
  readonly sources: readonly OutcomeContextSource[];
}

export async function openOutcomeContext(path: string): Promise<OutcomeContext> {
  const raw = await readFile(path, "utf8");
  if (Buffer.byteLength(raw) > OUTCOME_CONTEXT_MAX_TEXT_BYTES + 16_384) {
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
  assertKeys(value, ["schema_version", "subject", "sources"], source);
  if (!isRecord(value.subject)) {
    throw new Error(`Invalid outcome context at ${source}: subject must be an object.`);
  }
  assertKeys(value.subject, ["provider", "repository", "pull_request"], `${source}.subject`);
  if (value.subject.provider !== undefined && typeof value.subject.provider !== "string") {
    throw new Error(`Invalid outcome context at ${source}: subject.provider must be a string.`);
  }
  if (value.subject.repository !== undefined && typeof value.subject.repository !== "string") {
    throw new Error(`Invalid outcome context at ${source}: subject.repository must be a string.`);
  }
  if (!Array.isArray(value.sources) || value.sources.length === 0 || value.sources.length > 2) {
    throw new Error(`Invalid outcome context at ${source}: sources must contain one or two items.`);
  }
  const sources: OutcomeContextSource[] = [];
  const kinds = new Set<OutcomeContextSourceKind>();
  let totalBytes = 0;
  for (const item of value.sources) {
    if (!isRecord(item) || !isSourceKind(item.kind) || typeof item.text !== "string") {
      throw new Error(`Invalid outcome context at ${source}: each source requires kind and text.`);
    }
    assertKeys(item, ["kind", "text"], `${source}.sources`);
    if (item.text.trim() === "") {
      throw new Error(`Invalid outcome context at ${source}: source text must not be empty.`);
    }
    if (kinds.has(item.kind)) {
      throw new Error(`Invalid outcome context at ${source}: source kinds must be unique.`);
    }
    kinds.add(item.kind);
    totalBytes += Buffer.byteLength(item.text);
    sources.push(Object.freeze({ kind: item.kind, text: item.text }));
  }
  if (totalBytes > OUTCOME_CONTEXT_MAX_TEXT_BYTES) {
    throw new Error(`Invalid outcome context at ${source}: source text is too large.`);
  }
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
  });
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

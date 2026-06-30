import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const DEFAULT_INPUT_PATH = "/adversary/input.json";
export const DEFAULT_OUTPUT_PATH = "/adversary/output.json";
export const INPUT_SCHEMA_VERSION = "adversary.input.v1";
export const FINDINGS_SCHEMA_VERSION = "adversary.findings.v1";

export type Severity = "info" | "low" | "medium" | "high" | "critical";

export interface ChangedFile {
  path: string;
  status?: "added" | "modified" | "deleted" | "renamed" | "copied" | "unknown";
  oldPath?: string;
}

export interface ChangeContext {
  baseRef?: string;
  headRef?: string;
  files?: ChangedFile[];
}

export interface Input {
  schemaVersion: typeof INPUT_SCHEMA_VERSION;
  workspace: string;
  change?: ChangeContext;
  config?: Record<string, unknown>;
}

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  file?: string;
  line?: number;
  column?: number;
  evidence?: string;
  recommendation?: string;
  metadata?: Record<string, unknown>;
}

export interface Output {
  schemaVersion: typeof FINDINGS_SCHEMA_VERSION;
  findings: Finding[];
}

export interface AdversaryContext {
  input: Input;
  workspace: string;
  change?: ChangeContext;
  report: (finding: Finding) => void;
}

export type AdversaryHandler = (context: AdversaryContext) => void | Promise<void>;

export interface DefinedAdversary {
  run: (input?: Input) => Promise<Output>;
}

export function defineAdversary(handler: AdversaryHandler): DefinedAdversary {
  return {
    async run(input?: Input): Promise<Output> {
      const resolvedInput = input ?? (await parseInput());
      const findings: Finding[] = [];

      await handler({
        input: resolvedInput,
        workspace: resolvedInput.workspace,
        change: resolvedInput.change,
        report: (value) => {
          findings.push(finding(value));
        }
      });

      return {
        schemaVersion: FINDINGS_SCHEMA_VERSION,
        findings
      };
    }
  };
}

export function finding(value: Finding): Finding {
  assertFinding(value);
  return { ...value };
}

export async function parseInput(path = DEFAULT_INPUT_PATH): Promise<Input> {
  const raw = await readFile(path, "utf8");
  const parsed: unknown = JSON.parse(raw);

  if (!isRecord(parsed)) {
    throw new Error(`Invalid input at ${path}: expected an object.`);
  }

  if (parsed.schemaVersion !== INPUT_SCHEMA_VERSION) {
    throw new Error(
      `Invalid input at ${path}: expected schemaVersion "${INPUT_SCHEMA_VERSION}".`
    );
  }

  if (typeof parsed.workspace !== "string" || parsed.workspace.length === 0) {
    throw new Error(`Invalid input at ${path}: workspace must be a non-empty string.`);
  }

  if (parsed.change !== undefined) {
    assertChangeContext(parsed.change, path);
  }

  if (parsed.config !== undefined && !isRecord(parsed.config)) {
    throw new Error(`Invalid input at ${path}: config must be an object.`);
  }

  return parsed as unknown as Input;
}

export async function reportFinding(value: Finding, path = DEFAULT_OUTPUT_PATH): Promise<Output> {
  const output = await readOutputIfPresent(path);
  output.findings.push(finding(value));
  await writeOutput(output, path);
  return output;
}

export async function writeOutput(output: Output, path = DEFAULT_OUTPUT_PATH): Promise<void> {
  assertOutput(output);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(output, null, 2)}\n`, "utf8");
}

async function readOutputIfPresent(path: string): Promise<Output> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed: unknown = JSON.parse(raw);
    assertOutput(parsed);
    return parsed;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return {
        schemaVersion: FINDINGS_SCHEMA_VERSION,
        findings: []
      };
    }

    throw error;
  }
}

function assertOutput(value: unknown): asserts value is Output {
  if (!isRecord(value)) {
    throw new Error("Invalid output: expected an object.");
  }

  if (value.schemaVersion !== FINDINGS_SCHEMA_VERSION) {
    throw new Error(`Invalid output: expected schemaVersion "${FINDINGS_SCHEMA_VERSION}".`);
  }

  if (!Array.isArray(value.findings)) {
    throw new Error("Invalid output: findings must be an array.");
  }

  for (const item of value.findings) {
    assertFinding(item);
  }
}

function assertFinding(value: unknown): asserts value is Finding {
  if (!isRecord(value)) {
    throw new Error("Invalid finding: expected an object.");
  }

  requireString(value.id, "id");
  requireString(value.title, "title");

  if (!isSeverity(value.severity)) {
    throw new Error("Invalid finding: severity must be info, low, medium, high, or critical.");
  }

  optionalString(value.file, "file");
  optionalPositiveInteger(value.line, "line");
  optionalPositiveInteger(value.column, "column");
  optionalString(value.evidence, "evidence");
  optionalString(value.recommendation, "recommendation");

  if (value.metadata !== undefined && !isRecord(value.metadata)) {
    throw new Error("Invalid finding: metadata must be an object.");
  }
}

function assertChangeContext(value: unknown, path: string): asserts value is ChangeContext {
  if (!isRecord(value)) {
    throw new Error(`Invalid input at ${path}: change must be an object.`);
  }

  optionalString(value.baseRef, "change.baseRef");
  optionalString(value.headRef, "change.headRef");

  if (value.files !== undefined) {
    if (!Array.isArray(value.files)) {
      throw new Error(`Invalid input at ${path}: change.files must be an array.`);
    }

    for (const file of value.files) {
      if (!isRecord(file) || typeof file.path !== "string" || file.path.length === 0) {
        throw new Error(`Invalid input at ${path}: each change.files entry needs a path.`);
      }

      if (file.status !== undefined && !isChangedFileStatus(file.status)) {
        throw new Error(`Invalid input at ${path}: change.files.status is not supported.`);
      }

      optionalString(file.oldPath, "change.files.oldPath");
    }
  }
}

function requireString(value: unknown, field: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid finding: ${field} must be a non-empty string.`);
  }
}

function optionalString(value: unknown, field: string): void {
  if (value !== undefined && typeof value !== "string") {
    throw new Error(`Invalid value: ${field} must be a string.`);
  }
}

function optionalPositiveInteger(value: unknown, field: string): void {
  if (value !== undefined && (!Number.isInteger(value) || Number(value) < 1)) {
    throw new Error(`Invalid finding: ${field} must be a positive integer.`);
  }
}

function isSeverity(value: unknown): value is Severity {
  return (
    value === "info" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "critical"
  );
}

function isChangedFileStatus(value: unknown): value is ChangedFile["status"] {
  return (
    value === "added" ||
    value === "modified" ||
    value === "deleted" ||
    value === "renamed" ||
    value === "copied" ||
    value === "unknown"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

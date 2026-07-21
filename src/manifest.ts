import { readFileSync } from "node:fs";
import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import { parseAllDocuments } from "yaml";

export const ADVERSARY_MANIFEST_FILE_NAME = "adversary.yaml";
export const ADVERSARY_MANIFEST_MAX_BYTES = 1 << 20;

export interface DetectionManifest {
  files?: string[];
  entrypoint?: string;
}

export interface TriggerManifest {
  manual?: boolean;
  files_changed?: string[];
}

export interface RuntimeManifest {
  name?: "node" | "process";
  image?: string;
  version?: string;
  command: string[];
}

export interface FilesystemPermissionsManifest {
  read?: string[];
  write?: string[];
}

export interface EnvironmentPermissionsManifest {
  allow?: string[];
}

export interface PermissionsManifest {
  filesystem?: FilesystemPermissionsManifest;
  network?: boolean;
  environment?: EnvironmentPermissionsManifest;
  enforcement?: "advisory" | "required";
}

interface LegacyPermissionsManifest extends PermissionsManifest {
  env?: string[];
}

export interface FindingsManifest {
  format?: "adversary.review.v1";
}

export interface AdversaryManifest {
  name: string;
  version?: string;
  description?: string;
  triggers?: TriggerManifest;
  detection?: DetectionManifest;
  runtime: RuntimeManifest;
  permissions?: PermissionsManifest;
  findings?: FindingsManifest;
}

interface ParsedAdversaryManifest extends Omit<AdversaryManifest, "permissions"> {
  permissions?: LegacyPermissionsManifest;
}

export class ManifestValidationError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[] = []) {
    super(message);
    this.name = "ManifestValidationError";
    this.issues = issues;
  }
}

let manifestValidator: ValidateFunction<ParsedAdversaryManifest> | undefined;

export function parseAdversaryManifest(source: string | Uint8Array): AdversaryManifest {
  const text = typeof source === "string" ? source : new TextDecoder().decode(source);
  const size = Buffer.byteLength(text, "utf8");
  if (size > ADVERSARY_MANIFEST_MAX_BYTES) {
    throw new ManifestValidationError(
      `adversary.yaml is too large: ${size} bytes exceeds ${ADVERSARY_MANIFEST_MAX_BYTES} bytes`,
    );
  }

  const documents = parseAllDocuments(text, {
    prettyErrors: true,
    uniqueKeys: true,
  });
  if (documents.length !== 1) {
    throw new ManifestValidationError("manifest must contain exactly one YAML document");
  }
  const document = documents[0];
  if (document === undefined || document.contents === null) {
    throw new ManifestValidationError("manifest is empty");
  }
  if (document.errors.length > 0) {
    const issues = document.errors.map((error) => error.message);
    throw new ManifestValidationError(`decode manifest YAML: ${issues.join("; ")}`, issues);
  }

  let value: unknown;
  try {
    value = document.toJS({ maxAliasCount: 0 });
  } catch (error) {
    const issue = error instanceof Error ? error.message : String(error);
    throw new ManifestValidationError(`decode manifest YAML: ${issue}`, [issue]);
  }
  return validateAdversaryManifest(value);
}

export function validateAdversaryManifest(value: unknown): AdversaryManifest {
  const validator = getManifestValidator();
  if (!validator(value)) {
    const issues = (validator.errors ?? []).map(formatSchemaError);
    throw new ManifestValidationError(`invalid adversary manifest: ${issues.join("; ")}`, issues);
  }
  return normalizeLegacyPermissions(value);
}

function getManifestValidator(): ValidateFunction<ParsedAdversaryManifest> {
  if (manifestValidator !== undefined) return manifestValidator;
  const schema = JSON.parse(
    readFileSync(new URL("../schemas/adversary.manifest.v1.schema.json", import.meta.url), "utf8"),
  );
  manifestValidator = new Ajv2020({
    allErrors: true,
    strict: true,
  }).compile<ParsedAdversaryManifest>(schema);
  return manifestValidator;
}

function formatSchemaError(error: ErrorObject): string {
  const path = `manifest${error.instancePath.replaceAll("/", ".")}`;
  if (error.keyword === "pattern" && error.schemaPath === "#/$defs/portableProjectPath/pattern") {
    return `${path} must be a portable project-relative path`;
  }
  if (error.keyword === "additionalProperties") {
    return `${path} contains unknown field ${JSON.stringify(error.params.additionalProperty)}`;
  }
  if (error.keyword === "required") {
    return `${path} is missing required field ${JSON.stringify(error.params.missingProperty)}`;
  }
  return `${path} ${error.message ?? `failed ${error.keyword} validation`}`;
}

function normalizeLegacyPermissions(manifest: ParsedAdversaryManifest): AdversaryManifest {
  if (manifest.permissions?.env === undefined) return manifest;
  const { env, ...permissions } = manifest.permissions;
  return {
    ...manifest,
    permissions: {
      ...permissions,
      environment: { allow: env },
    },
  };
}

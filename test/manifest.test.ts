import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { stringify } from "yaml";
import {
  type AdversaryManifest,
  ManifestValidationError,
  parseAdversaryManifest,
  validateAdversaryManifest,
} from "../src/index.js";

const valid = `name: adversarylabs/example
version: 1.2.3
description: Example adversary.
triggers:
  manual: true
  files_changed:
    - "**/*.ts"
runtime:
  name: node
  version: "22"
  command:
    - dist/index.js
permissions:
  filesystem:
    read: ["."]
    write: [.adversary/results]
  network: false
  environment:
    allow: [CI]
findings:
  format: adversary.review.v1
`;

function withDetection(detection: string): string {
  return valid.replace("runtime:\n", `detection:\n${detection}\nruntime:\n`);
}

describe("adversary manifest detection", () => {
  it("preserves backward compatibility when detection is absent", () => {
    const manifest = parseAdversaryManifest(valid);
    expect(manifest.name).toBe("adversarylabs/example");
    expect(manifest.detection).toBeUndefined();
  });

  it("accepts and normalizes permissions.env from legacy SDK templates", () => {
    const legacy = valid.replace("  environment:\n    allow: [CI]", "  env: [CI]");
    const manifest = parseAdversaryManifest(legacy);
    expect(manifest.permissions?.environment).toEqual({ allow: ["CI"] });
    expect(manifest.permissions).not.toHaveProperty("env");
  });

  it("rejects ambiguous legacy and canonical environment permissions", () => {
    const ambiguous = valid.replace("  environment:\n", "  env: [CI]\n  environment:\n");
    expect(() => parseAdversaryManifest(ambiguous)).toThrow(ManifestValidationError);
  });

  it("parses declarative file detection", () => {
    const manifest = parseAdversaryManifest(
      withDetection('  files:\n    - Dockerfile\n    - "**/*.dockerfile"'),
    );
    expect(manifest.detection).toEqual({ files: ["Dockerfile", "**/*.dockerfile"] });
  });

  it("parses a detector entrypoint without requiring build output", () => {
    const manifest = parseAdversaryManifest(withDetection("  entrypoint: dist/detect.js"));
    expect(manifest.detection).toEqual({ entrypoint: "dist/detect.js" });
  });

  it("parses files and an entrypoint together", () => {
    const manifest = parseAdversaryManifest(
      withDetection("  files: [Dockerfile, .dockerignore]\n  entrypoint: dist/detect.js"),
    );
    expect(manifest.detection).toEqual({
      files: ["Dockerfile", ".dockerignore"],
      entrypoint: "dist/detect.js",
    });
  });

  it.each([
    ["invalid files scalar", "  files: Dockerfile", "manifest.detection.files must be array"],
    [
      "invalid files member",
      "  files: [Dockerfile, 42]",
      "manifest.detection.files.1 must be string",
    ],
    ["invalid entrypoint type", "  entrypoint: 42", "manifest.detection.entrypoint must be string"],
    ["null detection", "  ", "manifest.detection must be object"],
    ["sequence detection", "  - files", "manifest.detection must be object"],
    ["empty detection", "  {}", "manifest.detection must NOT have fewer than 1 properties"],
    ["empty files", "  files: []", "manifest.detection.files must NOT have fewer than 1 items"],
  ])("rejects %s with a useful path", (_name, detection, expected) => {
    expect(() => parseAdversaryManifest(withDetection(detection))).toThrowError(expected);
  });

  it.each(["../detect.js", "/tmp/detect.js", "dist\\detect.js", "dist/./detect.js"])(
    "rejects non-portable detector entrypoint %s",
    (entrypoint) => {
      expect(() =>
        parseAdversaryManifest(withDetection(`  entrypoint: ${JSON.stringify(entrypoint)}`)),
      ).toThrowError(/portable project-relative path/);
    },
  );

  it("rejects unknown detection fields", () => {
    expect(() =>
      parseAdversaryManifest(withDetection("  files: [Dockerfile]\n  score: 10")),
    ).toThrowError(/manifest\.detection contains unknown field "score"/);
  });

  it("validates plain objects through the same canonical model", () => {
    const manifest: AdversaryManifest = {
      name: "adversarylabs/example",
      detection: { files: ["Dockerfile"] },
      runtime: { name: "node", version: "22", command: ["dist/index.js"] },
    };
    expect(validateAdversaryManifest(manifest)).toBe(manifest);
    expect(() =>
      validateAdversaryManifest({ ...manifest, detection: { files: "Dockerfile" } }),
    ).toThrow(ManifestValidationError);
  });

  it("round-trips the parsed manifest without losing detection", () => {
    const first = parseAdversaryManifest(
      withDetection("  files: [Dockerfile, .dockerignore]\n  entrypoint: dist/detect.js"),
    );
    const second = parseAdversaryManifest(stringify(first));
    expect(second).toEqual(first);
  });

  it("keeps the shipped template and example on the canonical manifest contract", async () => {
    for (const path of [
      join(import.meta.dirname, "..", "templates", "basic", "adversary.yaml"),
      join(import.meta.dirname, "..", "examples", "comment-sentence-adversary", "adversary.yaml"),
    ]) {
      const manifest = parseAdversaryManifest(await readFile(path, "utf8"));
      expect(manifest.detection?.files).toEqual(["*.ts", "**/*.ts"]);
    }
  });

  it("publishes a JSON schema that validates all detection forms", async () => {
    const schema = JSON.parse(
      await readFile(
        join(import.meta.dirname, "..", "schemas", "adversary.manifest.v1.schema.json"),
        "utf8",
      ),
    );
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
    const base = parseAdversaryManifest(valid);
    expect(validate(base)).toBe(true);
    expect(validate({ ...base, detection: { files: ["Dockerfile"] } })).toBe(true);
    expect(validate({ ...base, detection: { entrypoint: "dist/detect.js" } })).toBe(true);
    expect(
      validate({
        ...base,
        detection: { files: ["Dockerfile"], entrypoint: "dist/detect.js" },
      }),
    ).toBe(true);
    expect(validate({ ...base, detection: {} })).toBe(false);
    expect(validate({ ...base, detection: { files: "Dockerfile" } })).toBe(false);
    for (const entrypoint of [
      "../detect.js",
      "/tmp/detect.js",
      "dist\\detect.js",
      "dist/./detect.js",
      "dist//detect.js",
    ]) {
      expect(validate({ ...base, detection: { entrypoint } }), entrypoint).toBe(false);
    }
  });

  it("keeps legacy environment permissions valid in the published schema", async () => {
    const schema = JSON.parse(
      await readFile(
        join(import.meta.dirname, "..", "schemas", "adversary.manifest.v1.schema.json"),
        "utf8",
      ),
    );
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
    const manifest = parseAdversaryManifest(valid);
    const { environment: _environment, ...legacyPermissions } = manifest.permissions ?? {};
    expect(validate({ ...manifest, permissions: { ...legacyPermissions, env: ["CI"] } })).toBe(
      true,
    );
    expect(validate({ ...manifest, permissions: { ...manifest.permissions, env: ["CI"] } })).toBe(
      false,
    );
  });
});

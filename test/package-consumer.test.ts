import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("packed package consumer", () => {
  it("works in clean JavaScript and strict TypeScript projects", async () => {
    const packageDirectory = join(import.meta.dirname, "..");
    const directory = await mkdtemp(join(tmpdir(), "adversary-sdk-consumer-"));
    const packDirectory = join(directory, "pack");
    const consumerDirectory = join(directory, "consumer");
    await execFileAsync("mkdir", ["-p", packDirectory, consumerDirectory]);

    const { stdout } = await execFileAsync(
      "npm",
      ["pack", "--ignore-scripts", "--pack-destination", packDirectory, "--json"],
      { cwd: packageDirectory },
    );
    const packed = JSON.parse(stdout) as Array<{ filename: string }>;
    const tarball = join(packDirectory, packed[0]?.filename ?? "missing.tgz");
    await writeFile(
      join(consumerDirectory, "package.json"),
      JSON.stringify({ private: true, type: "module" }),
    );
    await execFileAsync("npm", ["install", "--ignore-scripts", tarball], {
      cwd: consumerDirectory,
    });

    const imported = await execFileAsync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { Adversary, parseAdversaryManifest, validateRunEnvelope } from "@adversarylabs/sdk";
await validateRunEnvelope({
  protocolVersion: 1,
  result: {
    adversary: { name: "consumer" },
    target: {},
    positives: [],
    observations: [],
    findings: [],
    suppressed: { observations: 0, findings: 0 },
  },
});
const manifest = parseAdversaryManifest("name: consumer\\ndetection:\\n  files: [Dockerfile]\\nruntime:\\n  name: node\\n  version: '22'\\n  command: [dist/index.js]\\n");
console.log(typeof Adversary, manifest.detection.files[0]);`,
      ],
      { cwd: consumerDirectory },
    );
    expect(imported.stdout.trim()).toBe("function Dockerfile");

    await writeFile(
      join(consumerDirectory, "index.ts"),
      'import { Adversary, type AdversaryManifest, type DetectionManifest } from "@adversarylabs/sdk";\nconst app: Adversary = new Adversary({ name: "consumer" });\nconst detection: DetectionManifest = { files: ["Dockerfile"] };\nconst manifest: AdversaryManifest = { name: "consumer", detection, runtime: { name: "node", version: "22", command: ["dist/index.js"] } };\nvoid [app, manifest];\n',
    );
    await writeFile(
      join(consumerDirectory, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          module: "NodeNext",
          moduleResolution: "NodeNext",
        },
        files: ["index.ts"],
      }),
    );
    await execFileAsync(join(packageDirectory, "node_modules/.bin/tsc"), ["-p", "tsconfig.json"], {
      cwd: consumerDirectory,
    });

    for (const subpath of ["adversary.manifest.v1", "adversary.input.v1", "adversary.review.v1"]) {
      const resolved = await execFileAsync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `import { createRequire } from "node:module"; console.log(createRequire(import.meta.url).resolve("@adversarylabs/sdk/schemas/${subpath}"))`,
        ],
        { cwd: consumerDirectory },
      );
      const schema = JSON.parse(await readFile(resolved.stdout.trim(), "utf8"));
      expect(() => new Ajv2020({ strict: false }).compile(schema)).not.toThrow();
    }
  });
});

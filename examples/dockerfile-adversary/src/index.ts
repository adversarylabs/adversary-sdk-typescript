import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Adversary, Finding, Severity } from "@adversary/sdk";

const suspiciousNames = ["SECRET", "PASSWORD", "TOKEN", "API_KEY"];

const adversary = new Adversary({
  name: "adversarylabs/dockerfile",
  schemaVersion: "adversary.findings.v1",
});

adversary.rule("docker.suspicious.env", async (ctx) => {
  const dockerfiles = await ctx.rglob("Dockerfile*");
  const findings: Finding[] = [];

  ctx.summary.files_scanned = dockerfiles.length;

  for (const dockerfile of dockerfiles) {
    const content = await readFile(join(ctx.repoPath, dockerfile), "utf8");
    const lines = content.split(/\r?\n/);
    lines.forEach((line, index) => {
      const match = line.match(/^\s*(ENV|ARG)\s+([A-Za-z_][A-Za-z0-9_]*)\b/);
      if (!match) {
        return;
      }

      const variableName = match[2] ?? "";
      const upperName = variableName.toUpperCase();
      const matchedName = suspiciousNames.find((name) => upperName.includes(name));

      if (!matchedName) {
        return;
      }

      findings.push(
        new Finding({
          ruleId: "docker.suspicious.env",
          severity: Severity.High,
          title: `Suspicious Dockerfile ${match[1]} variable`,
          message: "Dockerfile may bake a secret-like variable into an image.",
          path: dockerfile,
          line: index + 1,
          evidence: line.trim(),
          recommendation:
            "Avoid baking secrets into images. Use runtime secrets or build-time secret mounts instead.",
          metadata: {
            variable: variableName,
            matchedName,
          },
        }),
      );
    });
  }

  return findings;
});

export default adversary;

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await adversary.run();
}

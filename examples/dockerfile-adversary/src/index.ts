import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { defineAdversary, finding, writeOutput } from "@adversarylabs/sdk";

const suspiciousNames = ["SECRET", "PASSWORD", "TOKEN", "API_KEY"];
const ignoredDirectories = new Set([".git", "node_modules", "dist", "coverage"]);

const adversary = defineAdversary(async ({ workspace, report }) => {
  for await (const file of walk(workspace)) {
    if (!isDockerfile(file)) {
      continue;
    }

    const content = await readFile(file, "utf8");
    const lines = content.split(/\r?\n/);
    const relativeFile = relative(workspace, file) || "Dockerfile";

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

      report(
        finding({
          id: "DOCKER-001",
          severity: "high",
          title: `Suspicious Dockerfile ${match[1]} variable`,
          file: relativeFile,
          line: index + 1,
          evidence: line.trim(),
          recommendation:
            "Avoid baking secrets into images. Use runtime secrets or build-time secret mounts instead.",
          metadata: {
            variable: variableName,
            matchedName
          }
        })
      );
    });
  }
});

export default adversary;

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await writeOutput(await adversary.run());
}

async function* walk(directory: string): AsyncGenerator<string> {
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        yield* walk(path);
      }
      continue;
    }

    if (entry.isFile()) {
      yield path;
    }
  }
}

function isDockerfile(path: string): boolean {
  const fileName = path.split(/[\\/]/).at(-1);
  return fileName === "Dockerfile" || fileName?.startsWith("Dockerfile.") === true;
}

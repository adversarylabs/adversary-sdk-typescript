import { pathToFileURL } from "node:url";
import { defineAdversary, finding, writeOutput } from "@adversarylabs/sdk";

const adversary = defineAdversary(async ({ report }) => {
  report(
    finding({
      id: "BASIC-001",
      severity: "info",
      title: "Basic adversary ran successfully",
      recommendation: "Replace this finding with checks for your own adversary."
    })
  );
});

export default adversary;

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await writeOutput(await adversary.run());
}

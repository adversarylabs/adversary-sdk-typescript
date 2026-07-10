import { pathToFileURL } from "node:url";
import { Adversary, Severity } from "@adversarylabs/sdk";

const adversary = new Adversary({
  name: "adversarylabs/basic",
  review: { includeInformational: true },
});

adversary.rule("basic.ran", (ctx) => {
  ctx.finding({
    ruleId: "basic.ran",
    category: "example",
    severity: Severity.Info,
    confidence: "high",
    title: "Basic adversary ran successfully",
    summary: "The template adversary executed successfully.",
    evidence: [{ message: "Template rule completed." }],
    recommendation: "Replace this finding with checks for your own adversary.",
  });
});

export default adversary;

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await adversary.runFromEnvironment();
}

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
  // Keep the published starter runnable with the bootstrap SDK pinned in its shrinkwrap.
  // New projects use the explicit runtime adapter; older 0.x SDKs retain run() as that adapter.
  if ("runFromEnvironment" in adversary) {
    await adversary.runFromEnvironment();
  } else {
    await (adversary.run as unknown as () => Promise<unknown>)();
  }
}

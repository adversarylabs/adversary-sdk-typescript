import { pathToFileURL } from "node:url";
import { Adversary, Finding, Severity } from "@adversary/sdk";

const adversary = new Adversary({
  name: "adversarylabs/basic",
  schemaVersion: "adversary.findings.v1",
});

adversary.rule("basic.ran", () => {
  return new Finding({
    ruleId: "basic.ran",
    severity: Severity.Info,
    title: "Basic adversary ran successfully",
    recommendation: "Replace this finding with checks for your own adversary.",
  });
});

export default adversary;

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await adversary.run();
}

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Adversary } from "@adversarylabs/sdk";

const adversary = new Adversary({
  name: "adversarylabs/comment-sentences",
  review: {
    includeInformational: true,
  },
});

adversary.rule("comments.complete-sentence", async (ctx) => {
  const files = await ctx.rglob("*.ts");
  ctx.summary.files_scanned = files.length;

  for (const file of files) {
    const content = await readFile(join(ctx.repoPath, file), "utf8");
    const lines = content.split(/\r?\n/);

    lines.forEach((line, index) => {
      const match = line.match(/^\s*\/\/\s+(.+)/);
      if (!match) {
        return;
      }

      const comment = match[1] ?? "";
      if (!isCompleteSentence(comment)) {
        return;
      }

      ctx.observe({
        ruleId: "comments.complete-sentence",
        subject: file,
        category: "code-style",
        severity: "info",
        confidence: "high",
        title: "Comments contain complete sentences",
        location: {
          file,
          line: index + 1,
        },
        evidence: {
          comment,
        },
        recommendation: {
          summary:
            "Use complete-sentence comments intentionally where they clarify non-obvious code.",
        },
        tags: ["style"],
      });
    });
  }

  ctx.review.assessment({
    risk: "none",
    summary: "This review only reports complete-sentence comments.",
  });

  ctx.review.opinion({
    ship: true,
    summary: "Comment sentence style does not block shipping.",
  });
});

export default adversary;

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await adversary.runFromEnvironment();
}

function isCompleteSentence(value: string): boolean {
  return /^[A-Z][^.!?]*[.!?]$/.test(value.trim());
}

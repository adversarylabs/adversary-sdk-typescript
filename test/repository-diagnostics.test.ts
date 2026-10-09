import { expect, it, vi } from "vitest";
import {
  RepositoryReadError,
  readErrorReason,
  repositoryDiagnostics,
  safeDiagnosticPath,
} from "../src/repository-diagnostics.js";

import { MAX_OPERATION_PATH_LENGTH, normalizeRepositoryPath } from "../src/repository-path.js";

it("classifies filesystem failures without exposing raw messages", () => {
  expect(
    readErrorReason(Object.assign(new Error("private credentials in message"), { code: "EACCES" })),
  ).toBe("permission_denied");
  expect(readErrorReason({ code: "ENOENT" })).toBe("file_missing");
  expect(readErrorReason(new Error("private credentials in message"))).toBe("read_failed");
  expect(safeDiagnosticPath("../secrets")).toBe("[invalid repository path]");
  expect(safeDiagnosticPath("/private/secrets")).toBe("[invalid repository path]");
  expect(safeDiagnosticPath("src/app/tags/[tag]/page.tsx")).toBe("src/app/tags/[tag]/page.tsx");
});

it("bounds records and reports when diagnostics were omitted", () => {
  const logs: string[] = [];
  const spy = vi.spyOn(process.stderr, "write").mockImplementation((line) => {
    logs.push(String(line));
    return true;
  });
  try {
    const diagnostics = repositoryDiagnostics("review/conventions", {
      maxRounds: 12,
      maxToolCalls: 80,
      maxTotalBytes: 720000,
      maxBytesPerRead: 64000,
      maxLinesPerRead: 800,
    });
    diagnostics.start();
    for (let i = 0; i < 2000; i++)
      diagnostics.emit(
        { kind: "gap", outcome: "missing", reason: "file_not_read", file: "source.ts" },
        { rounds: 1, toolCalls: 2, bytes: 1000 },
      );
    diagnostics.finish({ rounds: 1, toolCalls: 2, bytes: 1000 }, false);
    expect(logs.length).toBeLessThanOrEqual(1025);
    expect(JSON.parse(logs.at(-1) ?? "{}")).toMatchObject({
      kind: "session",
      outcome: "finished",
      complete: false,
      omittedRecords: expect.any(Number),
    });
  } finally {
    spy.mockRestore();
  }
});

it.each(["constructor", "toString", "__proto__", "hasOwnProperty"])(
  "does not classify inherited errno %s",
  (code) => {
    expect(readErrorReason({ code })).toBe("read_failed");
  },
);

it("classifies stable read reasons without matching English messages", () => {
  expect(readErrorReason(new RepositoryReadError("excluded_file", "wording may change"))).toBe(
    "excluded_file",
  );
  expect(readErrorReason(Object.assign(new Error("private path"), { code: "ENOENT" }))).toBe(
    "file_missing",
  );
  expect(readErrorReason(new Error("read_file does not support binary content"))).toBe(
    "read_failed",
  );
});

it("preserves the reader's bounded paths and labels invalid paths", () => {
  for (const path of [
    `${"a/".repeat(150)}source.ts`,
    "folder:name/source.ts",
    "folder\nname/source.ts",
    "./src/app/[slug]/page.ts",
    "a".repeat(MAX_OPERATION_PATH_LENGTH),
  ]) {
    expect(safeDiagnosticPath(path)).toBe(normalizeRepositoryPath(path));
  }
  for (const path of [
    "a".repeat(MAX_OPERATION_PATH_LENGTH + 1),
    "../private",
    "/private",
    "bad\0path",
  ]) {
    expect(normalizeRepositoryPath(path)).toBeUndefined();
    expect(safeDiagnosticPath(path)).toBe("[invalid repository path]");
  }
});

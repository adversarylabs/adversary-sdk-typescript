import { randomUUID } from "node:crypto";

export function readErrorReason(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string") {
    const codes: Record<string, string> = {
      ENOENT: "file_missing",
      EACCES: "permission_denied",
      EPERM: "permission_denied",
      ENOTDIR: "parent_not_directory",
      EIO: "io_error",
      ENOBUFS: "command_output_limit",
    };
    if (codes[code]) return codes[code];
  }
  const message = error instanceof Error ? error.message : "";
  if (message.endsWith("outside the configured repository file set")) return "excluded_file";
  if (message.includes("path must not be a symbolic link")) return "symlink_rejected";
  if (message.includes("path does not identify a regular")) return "not_regular_file";
  if (
    message.includes("bounded repository-relative path") ||
    message.includes("path escapes the repository root")
  )
    return "unsafe_path";
  if (message === "read_file requires a valid inclusive 1-based line range") return "invalid_range";
  if (/^read_file line \d+ is beyond the available text$/.test(message)) return "range_past_eof";
  if (message === "read_file does not support binary content") return "binary_file";
  if (message === "read_change requires a runner-provided change context")
    return "change_context_missing";
  if (message === "read_change path is not in the runner-provided change set")
    return "file_not_changed";
  if (message === "change revision is invalid") return "invalid_revision";
  return "read_failed";
}

export function safeDiagnosticPath(path: string): string {
  const normalized =
    path
      .trim()
      .replaceAll("\\", "/")
      .replace(/^\.\/+/u, "") || ".";
  if (
    normalized.length > 256 ||
    normalized.startsWith("/") ||
    Array.from(normalized).some(
      (char) => char.charCodeAt(0) <= 31 || char.charCodeAt(0) === 127 || char === ":",
    ) ||
    normalized.split("/").includes("..")
  )
    return "";
  return normalized;
}

type Counts = { rounds: number; toolCalls: number; bytes: number };
type Limits = {
  maxRounds: number;
  maxToolCalls: number;
  maxTotalBytes: number;
  maxBytesPerRead: number;
  maxLinesPerRead: number;
};
export function repositoryDiagnostics(
  reviewer: string | undefined,
  limits: Limits,
  enabled = true,
) {
  const readingId = randomUUID();
  // Each retrieval is already bounded to 128 operations. Cap gap diagnostics too.
  let records = 0;
  let omitted = 0;
  const emit = (details: Record<string, string | number | boolean>, counts: Counts) => {
    if (!enabled) return;
    if (records++ >= 1024) {
      omitted++;
      return;
    }
    process.stderr.write(
      `${JSON.stringify({
        event: "repository.read-detail",
        readingId,
        reviewer:
          reviewer && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,95}$/.test(reviewer) ? reviewer : "unknown",
        ...details,
        ...counts,
        callsRemaining: Math.max(0, limits.maxToolCalls - counts.toolCalls),
        bytesRemaining: Math.max(0, limits.maxTotalBytes - counts.bytes),
      })}\n`,
    );
  };
  return {
    readingId,
    emit,
    start: () =>
      emit(
        { kind: "session", outcome: "started", ...limits },
        { rounds: 0, toolCalls: 0, bytes: 0 },
      ),
    finish: (counts: Counts, complete: boolean) => {
      // Reserve a completion record even when the diagnostic cap was reached.
      records = Math.min(records, 1023);
      emit({ kind: "session", outcome: "finished", complete, omittedRecords: omitted }, counts);
    },
  };
}

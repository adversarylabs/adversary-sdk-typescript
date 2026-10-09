import { randomUUID } from "node:crypto";
import { writeRepositoryDiagnostic } from "./repository-diagnostics.js";

function identity(value: string | undefined): string {
  return value && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value) ? value : "unknown";
}

const failureCodes = new Set([
  "broker_unavailable",
  "model_timeout",
  "model_response_too_large",
  "model_response_limit",
  "invalid_broker_response",
  "unsupported_model_protocol",
  "invalid_model_output",
  "invalid_model_schema",
  "model_review_failed",
  "bad_gateway",
  "rate_limited",
  "provider_unavailable",
]);

/** Bounded, content-free broker timing; never changes request or retry behavior. */
export function modelAttemptDiagnostics(deadlineMs: number) {
  const requestId = randomUUID();
  const reviewStarted = performance.now();
  const jobId = identity(process.env.HOSTED_REVIEW_JOB_ID);
  const provider = identity(process.env.ADVERSARY_MODEL_PROVIDER);
  const model = identity(process.env.ADVERSARY_MODEL);
  return {
    startRetryDelay(attempt: number) {
      const started = performance.now();
      const remainingDeadlineMs = Math.max(0, Math.round(deadlineMs - (started - reviewStarted)));
      return (failureCode: string) => {
        writeRepositoryDiagnostic({
          event: "model.retry-delay",
          requestId,
          jobId,
          stage: "broker_retry_delay",
          attempt,
          deadlineMs,
          remainingDeadlineMs,
          elapsedMs: Math.round(performance.now() - started),
          outcome: "failed",
          provider,
          model,
          identitySource: "runner_environment",
          failureCode: failureCodes.has(failureCode) ? failureCode : "model_review_failed",
        });
      };
    },
    start(attempt: number) {
      const started = performance.now();
      const record = {
        event: "model.attempt",
        requestId,
        jobId,
        stage: "model_review",
        attempt,
        deadlineMs,
        remainingDeadlineMs: Math.max(0, Math.round(deadlineMs - (started - reviewStarted))),
      };
      writeRepositoryDiagnostic({ ...record, outcome: "started", elapsedMs: 0, provider, model });
      return (
        outcome: "succeeded" | "failed",
        actualProvider?: string,
        actualModel?: string,
        failureCode?: string,
      ) => {
        writeRepositoryDiagnostic({
          ...record,
          outcome,
          elapsedMs: Math.round(performance.now() - started),
          provider: actualProvider === undefined ? provider : identity(actualProvider),
          model: actualModel === undefined ? model : identity(actualModel),
          identitySource: actualProvider === undefined ? "runner_environment" : "broker_response",
          ...(failureCode === undefined
            ? {}
            : { failureCode: failureCodes.has(failureCode) ? failureCode : "model_review_failed" }),
        });
      };
    },
  };
}

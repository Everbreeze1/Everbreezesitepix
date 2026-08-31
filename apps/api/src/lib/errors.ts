import { readsAsDatabaseInternals } from "@everlumen/shared";
import type { ZodError, ZodIssue } from "zod";

import { AuthError } from "./user-context";

export type ApiErrorBody = {
  code: string;
  message: string;
};

/** Field labels for the paths users actually see rejected, so the toast names the box they were typing in. */
const FIELD_LABELS: Record<string, string> = {
  title: "Title",
  name: "Name",
  caption: "Caption",
  description: "Description",
  email: "Email",
  contentHtml: "Content",
};

function labelForPath(path: ZodIssue["path"]): string | null {
  // Array indices carry no meaning for a person; the field name does.
  const segments = path.filter((p) => typeof p === "string") as string[];
  if (segments.length === 0) return null;
  const leaf = segments[segments.length - 1];
  return FIELD_LABELS[leaf] ?? null;
}

/**
 * A one-line, human-readable summary of a validation failure.
 *
 * `ZodError.message` is `JSON.stringify(issues, null, 2)` - the raw issue array,
 * newlines and all. Handlers used to forward it verbatim as the API's `message`,
 * and the web client pipes `message` straight into a toast, so clearing the
 * document title on a phone produced a red box reading
 * `[ { "code": "too_small", "minimum": 1, … "path": [ "title" ] } ]`.
 * Raw validator output belongs in `details` for the console; this is the line
 * for the person holding the phone.
 */
export function validationMessage(err: ZodError): string {
  const issue = err.issues[0];
  if (!issue) return "Some of the information sent was invalid";

  const label = labelForPath(issue.path);
  if (!label) return "Some of the information sent was invalid";

  if (issue.code === "too_small" && issue.type === "string" && Number(issue.minimum) <= 1) {
    return `${label} can't be empty`;
  }
  if (issue.code === "too_big" && issue.type === "string") {
    return `${label} is too long (max ${issue.maximum} characters)`;
  }
  if (issue.code === "invalid_type" && issue.received === "undefined") {
    return `${label} is required`;
  }
  return `${label} is invalid`;
}

export function jsonError(status: number, code: string, message: string): Response {
  return Response.json({ code, message } satisfies ApiErrorBody, { status });
}

export function jsonOk<T>(data: T, init?: ResponseInit): Response {
  return Response.json(data, init);
}

/** Maps a deliberate client-error status to a stable machine-readable code. */
function codeForStatus(status: number): string {
  switch (status) {
    case 400:
      return "bad_request";
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 409:
      return "conflict";
    case 422:
      return "unprocessable";
    case 429:
      return "rate_limited";
    default:
      return "error";
  }
}

export { readsAsDatabaseInternals } from "@everlumen/shared";

export function jsonFromUnknownError(err: unknown, fallbackStatus = 500): Response {
  if (err instanceof AuthError) {
    return jsonError(err.status, "unauthorized", err.message);
  }
  /*
   * Honour a `status` deliberately attached to a thrown Error - the codebase
   * signals intentional client errors as `Object.assign(new Error(msg), {
   * status: 403 })` (auth gates, ownership checks, plan gates). Without this
   * branch every one of them collapsed to a generic 500 "internal_error", so a
   * "requires the Team plan" rejection reached the client looking like a server
   * crash: the wrong status for retries, and no clean message for the UI. Only
   * 4xx is trusted here - a stray 5xx stays an opaque internal error and its
   * message is not forwarded.
   */
  const status = (err as { status?: unknown })?.status;
  if (typeof status === "number" && status >= 400 && status < 500) {
    const message = err instanceof Error ? err.message : "Request failed";
    return jsonError(status, codeForStatus(status), message);
  }
  /*
   * An explicitly constructed 5xx may forward its message, if it opts in.
   *
   * The rule above deliberately distrusts 5xx, because a message that reached
   * the client by accident is how internals leak. But "the AI provider is
   * rate-limiting us" and "Stripe is down" are 5xx by the correct reading -
   * upstream failed, not the caller - and collapsing them to a bare
   * "Internal error" tells a customer their own action was broken when the
   * honest answer is "try again in a moment". `expose` is opt-in and set only
   * where the message was written for a person to read.
   */
  const exposed = (err as { expose?: unknown })?.expose === true;
  if (exposed && typeof status === "number" && status >= 500 && status < 600) {
    const message = err instanceof Error ? err.message : "Upstream request failed";
    return jsonError(status, status === 503 ? "service_unavailable" : "upstream_error", message);
  }
  const raw = err instanceof Error ? err.message : "Internal error";
  /*
   * The audit log still keeps the real text (see the `meta` field where this is
   * caught), so nothing is lost for whoever has to diagnose it. What changes is
   * that the customer stops reading it.
   */
  const message = readsAsDatabaseInternals(raw)
    ? "Something went wrong saving that. Try again, and tell us if it keeps happening."
    : raw;
  return jsonError(fallbackStatus, "internal_error", message);
}

export { AuthError };

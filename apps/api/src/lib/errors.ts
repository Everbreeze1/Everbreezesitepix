import { AuthError } from "./user-context";

export type ApiErrorBody = {
  code: string;
  message: string;
};

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

export function jsonFromUnknownError(err: unknown, fallbackStatus = 500): Response {
  if (err instanceof AuthError) {
    return jsonError(err.status, "unauthorized", err.message);
  }
  /*
   * Honour a `status` deliberately attached to a thrown Error — the codebase
   * signals intentional client errors as `Object.assign(new Error(msg), {
   * status: 403 })` (auth gates, ownership checks, plan gates). Without this
   * branch every one of them collapsed to a generic 500 "internal_error", so a
   * "requires the Team plan" rejection reached the client looking like a server
   * crash: the wrong status for retries, and no clean message for the UI. Only
   * 4xx is trusted here — a stray 5xx stays an opaque internal error and its
   * message is not forwarded.
   */
  const status = (err as { status?: unknown })?.status;
  if (typeof status === "number" && status >= 400 && status < 500) {
    const message = err instanceof Error ? err.message : "Request failed";
    return jsonError(status, codeForStatus(status), message);
  }
  const message = err instanceof Error ? err.message : "Internal error";
  return jsonError(fallbackStatus, "internal_error", message);
}

export { AuthError };

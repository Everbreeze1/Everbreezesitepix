import { AuthError } from "./user-context";

export type ApiErrorBody = {
  code: string;
  message: string;
};

export function jsonError(
  status: number,
  code: string,
  message: string,
): Response {
  return Response.json({ code, message } satisfies ApiErrorBody, { status });
}

export function jsonOk<T>(data: T, init?: ResponseInit): Response {
  return Response.json(data, init);
}

export function jsonFromUnknownError(err: unknown, fallbackStatus = 500): Response {
  if (err instanceof AuthError) {
    return jsonError(err.status, "unauthorized", err.message);
  }
  const message = err instanceof Error ? err.message : "Internal error";
  return jsonError(fallbackStatus, "internal_error", message);
}

export { AuthError };

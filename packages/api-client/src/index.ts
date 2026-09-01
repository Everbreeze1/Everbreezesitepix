/** Stable API error shape for web + future mobile clients. */
export type ApiErrorBody = {
  code: string;
  message: string;
};

export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = body.code;
  }
}

export type HealthResponse = {
  ok: true;
  service: "everlumen-api";
  version: "v1";
};

export type FieldReportRequest = {
  subject: string;
  pdfBase64: string;
  pdfName: string;
};

export type FieldReportResponse = {
  ok: true;
  sentTo: string;
  messageId: string;
};

export type RequestOptions = {
  /** Deduplicates expensive side effects for 24h when the server supports it. */
  idempotencyKey?: string;
  /** Correlates logs; echoed as `X-Request-Id`. */
  requestId?: string;
  /**
   * How long to wait before giving up. Defaults to `DEFAULT_TIMEOUT_MS`.
   *
   * Raise it for the handful of ops that are legitimately slow - anything that
   * waits on the AI provider - and leave it alone everywhere else.
   */
  timeoutMs?: number;
};

/**
 * The request budget, and why there is one at all.
 *
 * There was no timeout here. `fetch` in React Native has no default, so a
 * request that never gets a response never settles: the promise stays pending,
 * TanStack Query keeps `isLoading` true, and the screen shows its loading
 * skeleton forever. No error, no retry button, nothing to tap. It reads exactly
 * like a feature that does not work.
 *
 * That is not a rare condition for this app. Crews use it in basements, plant
 * rooms and rural sites, and a phone handing over between towers routinely
 * leaves a half-open socket: the connection is up as far as the client is
 * concerned, and no bytes are ever coming back. Without a deadline the app has
 * no way to notice.
 *
 * Thirty seconds is long enough that a slow site connection still completes and
 * short enough that somebody is not left staring at a skeleton. What matters is
 * far less the number than that a hung request now ends in a message with a
 * "Try again" under it.
 */
export const DEFAULT_TIMEOUT_MS = 30_000;

/** The AI ops wait on a provider, and 30s is not enough for them. */
export const AI_TIMEOUT_MS = 120_000;

export type CreateApiClientOptions = {
  /** Base URL including origin, e.g. https://api.example.com or "" for same-origin. */
  baseUrl: string;
  /** Returns a Everlumen JWT, or null when unauthenticated. */
  getAccessToken?: () => Promise<string | null> | string | null;
  fetch?: typeof fetch;
};

async function parseError(res: Response): Promise<ApiClientError> {
  let body: ApiErrorBody = {
    code: "unknown",
    message: res.statusText || "Request failed",
  };
  try {
    const json = (await res.json()) as Partial<ApiErrorBody>;
    if (json && typeof json === "object") {
      body = {
        code: typeof json.code === "string" ? json.code : body.code,
        message: typeof json.message === "string" ? json.message : body.message,
      };
    }
  } catch {
    // keep defaults
  }
  return new ApiClientError(res.status, body);
}

/**
 * Typed HTTP client for Everlumen `/v1/...` API.
 */
export function createApiClient(options: CreateApiClientOptions) {
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const doFetch = options.fetch ?? fetch;

  async function request<T>(
    path: string,
    init: RequestInit = {},
    reqOpts?: RequestOptions,
  ): Promise<T> {
    const headers = new Headers(init.headers);
    if (!headers.has("Accept")) headers.set("Accept", "application/json");

    const token = options.getAccessToken ? await options.getAccessToken() : null;
    if (token) headers.set("Authorization", `Bearer ${token}`);
    if (reqOpts?.idempotencyKey) {
      headers.set("Idempotency-Key", reqOpts.idempotencyKey);
    }
    if (reqOpts?.requestId) {
      headers.set("X-Request-Id", reqOpts.requestId);
    }

    /*
     * An existing signal wins: a caller that brought its own cancellation
     * (a screen unmounting, say) means it, and layering a second abort on top
     * would fight it.
     */
    const timeoutMs = reqOpts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = init.signal ? null : new AbortController();
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

    let res: Response;
    try {
      res = await doFetch(`${baseUrl}${path}`, {
        ...init,
        headers,
        ...(controller ? { signal: controller.signal } : {}),
      });
    } catch (cause) {
      /*
       * An abort we raised ourselves is a timeout, and has to say so. Left as
       * the raw `AbortError` it reaches the screen as "Aborted", which tells
       * somebody standing in a plant room nothing about what to do next.
       */
      if (controller?.signal.aborted) {
        throw new ApiClientError(408, {
          code: "timeout",
          message: "The server did not answer in time. Check your signal and try again.",
        });
      }
      throw cause;
    } finally {
      if (timer) clearTimeout(timer);
    }

    if (!res.ok) throw await parseError(res);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  return {
    health: () => request<HealthResponse>("/v1/health"),

    /**
     * Generic RPC bridge for domain ops (mobile + future web migration).
     * Body: `{ op: string, data?: unknown }` → JSON result.
     * Pass `idempotencyKey` for expensive ops (AI, email, walkthrough finish, …).
     */
    rpc: <T = unknown>(op: string, data?: unknown, reqOpts?: RequestOptions) =>
      request<T>(
        "/v1/rpc",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ op, data }),
        },
        reqOpts,
      ),

    email: {
      sendFieldReport: (body: FieldReportRequest, reqOpts?: RequestOptions) =>
        request<FieldReportResponse>(
          "/v1/email/field-report",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
          reqOpts,
        ),
    },

    /** Absolute paths for browser navigation / window.open (same-origin). */
    urls: {
      reportPdf: (token: string) => `${baseUrl}/v1/reports/${token}/pdf`,
      walkthroughPdf: (token: string) => `${baseUrl}/v1/walkthroughs/${token}/pdf`,
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

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
};

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

    const res = await doFetch(`${baseUrl}${path}`, { ...init, headers });
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

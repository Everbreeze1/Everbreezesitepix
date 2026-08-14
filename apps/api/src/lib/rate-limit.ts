/**
 * Simple fixed-window rate limiter, in-process.
 *
 * Scope is **one API instance**: the counters live in this Node process's heap,
 * so they reset on every Railway deploy/restart and are not a cluster-wide
 * quota - run two replicas and each one grants the full limit independently.
 * Good enough for abuse dampening, not for billing-grade enforcement. Making it
 * a real shared quota means moving the buckets to an external store (Redis or a
 * Postgres counter) keyed exactly as `clientRateKey` keys them; that is a
 * follow-up, not a drop-in swap, because it turns every check into a round trip.
 *
 * Memory: the map used to grow forever (one entry per user/IP, never removed).
 * It is now swept lazily from `rateLimit()` - no `setInterval`, which would keep
 * the event loop alive and fight the graceful shutdown in server.ts - plus a
 * hard size cap as a backstop.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** Sweep at most this often; a sweep is O(size) so it must not run per request. */
const SWEEP_INTERVAL_MS = 60_000;

/** Backstop for a flood of unique keys arriving faster than they expire. */
const MAX_BUCKETS = 10_000;

/**
 * Trim below the cap, not exactly to it. Shedding to `MAX_BUCKETS` leaves the
 * map one insert away from being over again, so the very next unique key would
 * re-enter the O(n log n) trim - turning the backstop into per-request work for
 * exactly the flood it exists to absorb (`invite:<token>` in teams/service.ts
 * and a spoofable `x-forwarded-for` both mint unique keys freely).
 */
const EVICT_TO = 9_000;

let lastSweepAt = 0;

function sweep(now: number): void {
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) buckets.delete(key);
  }
  lastSweepAt = now;

  if (buckets.size <= MAX_BUCKETS) return;
  // Still over cap after dropping the expired ones, so shed live buckets too,
  // soonest-to-reset first - those are the cheapest to lose, since a dropped
  // bucket only restarts that key's window slightly early.
  const oldestFirst = [...buckets.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
  for (const [key] of oldestFirst.slice(0, buckets.size - EVICT_TO)) {
    buckets.delete(key);
  }
}

export type RateLimitResult =
  | { ok: true; remaining: number; resetAt: number }
  | { ok: false; remaining: 0; resetAt: number; retryAfterSec: number };

export function rateLimit(options: {
  key: string;
  limit: number;
  windowMs: number;
  now?: number;
}): RateLimitResult {
  const now = options.now ?? Date.now();

  // Amortised eviction: the cost is paid by whichever request happens to cross
  // the interval, and only ever after the map has had time to accumulate.
  if (now - lastSweepAt >= SWEEP_INTERVAL_MS || buckets.size > MAX_BUCKETS) {
    sweep(now);
  }

  const existing = buckets.get(options.key);

  if (!existing || now >= existing.resetAt) {
    const resetAt = now + options.windowMs;
    buckets.set(options.key, { count: 1, resetAt });
    return { ok: true, remaining: options.limit - 1, resetAt };
  }

  if (existing.count >= options.limit) {
    return {
      ok: false,
      remaining: 0,
      resetAt: existing.resetAt,
      retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  existing.count += 1;
  return {
    ok: true,
    remaining: options.limit - existing.count,
    resetAt: existing.resetAt,
  };
}

/** Best-effort client key: user id, else IP-ish header, else "anon". */
export function clientRateKey(request: Request, userId?: string | null): string {
  if (userId) return `user:${userId}`;
  const forwarded = request.headers.get("cf-connecting-ip")
    ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? request.headers.get("x-real-ip");
  if (forwarded) return `ip:${forwarded}`;
  return "anon";
}

export function rateLimitHeaders(result: RateLimitResult, limit: number): HeadersInit {
  return {
    "X-RateLimit-Limit": String(limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
    ...(result.ok
      ? {}
      : { "Retry-After": String(result.retryAfterSec) }),
  };
}

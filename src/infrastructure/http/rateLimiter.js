import { performance } from 'node:perf_hooks';

/**
 * In-memory fixed-window rate limiter, one counter per key (client IP).
 *
 * Memory protection:
 *  - one tiny record per key, never per request;
 *  - expired records are removed by a periodic sweep (unref'd timer) and, when
 *    the store is full, before inserting a new key;
 *  - the store is hard-capped at `maxKeys`. When it is still full after
 *    sweeping, NEW keys are rejected (fail closed) instead of evicting live
 *    records, so an attacker cannot flush other clients' counters.
 *
 * Records are kept in a Map in insertion order. A record is deleted and
 * re-inserted when its window restarts, so the Map is always ordered by
 * expiry and a sweep stops at the first live record.
 *
 * SINGLE INSTANCE ONLY: state lives in this process. It is lost on restart
 * and is not shared between instances (see B2.2-REPORT.md).
 *
 * @typedef {{ allowed: boolean, limit: number, remaining: number,
 *             resetSeconds: number, retryAfterSeconds: number }} RateLimitDecision
 *
 * @param {{ max: number, windowMs: number, maxKeys?: number,
 *           sweepIntervalMs?: number, now?: () => number }} options
 *        `now` must be monotonic milliseconds (default: performance.now).
 */
export function createRateLimiter({
  max,
  windowMs,
  maxKeys = 10_000,
  sweepIntervalMs = Math.min(windowMs, 60_000),
  now = () => performance.now(),
}) {
  for (const [name, value] of Object.entries({ max, windowMs, maxKeys, sweepIntervalMs })) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new RangeError(`${name} must be a positive integer`);
    }
  }

  /** @type {Map<string, { count: number, resetAt: number }>} */
  const records = new Map();

  const secondsUntil = (resetAt, t) => Math.max(1, Math.ceil((resetAt - t) / 1000));

  /** Remove expired records. Returns how many were removed. */
  function sweep(t = now()) {
    let removed = 0;
    for (const [key, rec] of records) {
      if (rec.resetAt > t) break; // ordered by expiry: everything after is live
      records.delete(key);
      removed += 1;
    }
    return removed;
  }

  const timer = setInterval(() => sweep(), sweepIntervalMs);
  timer.unref();

  /** @returns {RateLimitDecision} */
  function check(key) {
    const t = now();
    let rec = records.get(key);

    if (rec && rec.resetAt <= t) {
      records.delete(key); // window over: restart (re-insert keeps expiry order)
      rec = undefined;
    }

    if (!rec) {
      if (records.size >= maxKeys) {
        sweep(t);
      }
      if (records.size >= maxKeys) {
        const oldest = records.values().next().value;
        const retry = secondsUntil(oldest.resetAt, t);
        return { allowed: false, limit: max, remaining: 0, resetSeconds: retry, retryAfterSeconds: retry };
      }
      rec = { count: 0, resetAt: t + windowMs };
      records.set(key, rec);
    }

    const resetSeconds = secondsUntil(rec.resetAt, t);
    if (rec.count >= max) {
      return { allowed: false, limit: max, remaining: 0, resetSeconds, retryAfterSeconds: resetSeconds };
    }
    rec.count += 1;
    return { allowed: true, limit: max, remaining: max - rec.count, resetSeconds, retryAfterSeconds: 0 };
  }

  return {
    check,
    sweep,
    /** Number of live + not-yet-swept records. */
    size: () => records.size,
    /** Stop the background sweep timer. */
    stop: () => clearInterval(timer),
  };
}

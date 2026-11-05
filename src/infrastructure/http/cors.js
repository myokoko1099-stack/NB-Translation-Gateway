/**
 * Phase 05-B2.3: CORS allowlist policy.
 *
 * Rules:
 *  - No `Origin` header  -> allowed (native Android / curl / server-to-server;
 *    these are not browsers and CORS does not apply to them). No CORS headers.
 *  - `Origin` in the allowlist (exact string match) -> allowed; the response
 *    echoes THAT origin. A wildcard `*` is never sent.
 *  - Any other `Origin` (including the literal `null`, and every origin when
 *    the allowlist is empty) -> denied (caller answers 403).
 *  - Credentials are never enabled (`Access-Control-Allow-Credentials` is not
 *    sent); the API authenticates with an Authorization header, not cookies.
 *
 * The allowlist itself is parsed and validated in config/config.js
 * (GATEWAY_CORS_ALLOWED_ORIGINS).
 */

/** Request headers a browser client may send cross-origin. */
export const CORS_ALLOWED_HEADERS = Object.freeze(['authorization', 'content-type']);

/** Response headers a browser client is allowed to read cross-origin. */
export const CORS_EXPOSED_HEADERS = Object.freeze([
  'x-request-id',
  'retry-after',
  'ratelimit-limit',
  'ratelimit-remaining',
  'ratelimit-reset',
]);

/** How long a browser may cache a successful preflight (seconds). */
export const PREFLIGHT_MAX_AGE_SECONDS = 600;

const ALLOWED_HEADER_SET = new Set(CORS_ALLOWED_HEADERS);
const EXPOSE_VALUE = CORS_EXPOSED_HEADERS.join(', ');

/**
 * @param {readonly string[]} [allowedOrigins] exact origins, already validated by loadConfig
 */
export function createCorsPolicy(allowedOrigins = []) {
  const allowed = new Set(allowedOrigins);

  return Object.freeze({
    /**
     * Classify the request's Origin.
     * @param {import('node:http').IncomingMessage} req
     * @returns {{ type: 'absent' } | { type: 'denied' } |
     *           { type: 'allowed', origin: string, headers: Record<string, string> }}
     */
    evaluate(req) {
      const origin = req.headers.origin;
      if (origin === undefined) return { type: 'absent' };
      if (!allowed.has(origin)) return { type: 'denied' };
      return {
        type: 'allowed',
        origin,
        headers: {
          'access-control-allow-origin': origin,
          'access-control-expose-headers': EXPOSE_VALUE,
        },
      };
    },

    /** A CORS preflight is an OPTIONS request carrying Origin + Access-Control-Request-Method. */
    isPreflight(req) {
      return (
        req.method === 'OPTIONS' &&
        req.headers.origin !== undefined &&
        req.headers['access-control-request-method'] !== undefined
      );
    },

    /**
     * Validate a preflight for an already-allowed origin.
     * @param {import('node:http').IncomingMessage} req
     * @param {string} origin an origin already accepted by evaluate()
     * @param {string[]} routeMethods methods the matched route supports
     * @returns {{ ok: true, headers: Record<string, string> } | { ok: false }}
     */
    preflight(req, origin, routeMethods) {
      const requestedMethod = req.headers['access-control-request-method'];
      if (!routeMethods.includes(requestedMethod)) return { ok: false };

      const requestedHeaders = req.headers['access-control-request-headers'];
      if (requestedHeaders !== undefined) {
        for (const raw of requestedHeaders.split(',')) {
          const name = raw.trim().toLowerCase();
          if (name !== '' && !ALLOWED_HEADER_SET.has(name)) return { ok: false };
        }
      }

      return {
        ok: true,
        headers: {
          'access-control-allow-origin': origin,
          'access-control-allow-methods': routeMethods.join(', '),
          'access-control-allow-headers': CORS_ALLOWED_HEADERS.join(', '),
          'access-control-max-age': String(PREFLIGHT_MAX_AGE_SECONDS),
          vary: 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers',
        },
      };
    },
  });
}

import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { AppError } from '../../domain/errors.js';
import { validateTranslateRequest } from '../../domain/translation.js';
import { unauthorizedError } from './auth.js';
import { resolveClientIp } from './clientIp.js';
import { describeError } from '../logging/redact.js';
import { createCorsPolicy } from './cors.js';
import { toClientError } from './errorResponse.js';
import { readJsonBody } from './httpProtection.js';
import { SECURITY_HEADERS } from './securityHeaders.js';

// Phase 05-B2.3: security headers (nosniff, referrer-policy, frame/CSP/
// permissions policies) are part of the base for every response, and
// `Vary: Origin` is always present because CORS decisions depend on Origin.
const BASE_HEADERS = Object.freeze({
  'cache-control': 'no-store',
  vary: 'Origin',
  ...SECURITY_HEADERS,
});

const JSON_HEADERS = Object.freeze({
  ...BASE_HEADERS,
  'content-type': 'application/json; charset=utf-8',
});

/** Routes that require a valid Bearer token. /health stays public. */
const PROTECTED_PATHS = new Set(['/v1/translate']);

const AUTH_NOT_ENFORCED = Object.freeze({ enabled: false, authenticate: () => ({ ok: true }) });

function sendJson(res, status, payload, extraHeaders) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    ...JSON_HEADERS,
    'content-length': Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

/** 204 response with no body (CORS preflight). */
function sendNoContent(res, extraHeaders) {
  res.writeHead(204, { ...BASE_HEADERS, ...extraHeaders });
  res.end();
}

/**
 * Build (but do not start) the HTTP server.
 *
 * Request pipeline (order matters and is unchanged for B1/B2.1/B2.2 traffic):
 *   1. CORS origin check (only when an Origin header is present)   -> 403
 *   2. route lookup                                                -> 404
 *   3. CORS preflight (OPTIONS + Origin + ACRM), no auth/rate cost -> 204 / 403
 *   4. method check                                                -> 405
 *   5. Bearer authentication (protected paths)                     -> 401
 *   6. rate limiting (protected paths)                             -> 429
 *   7. handler: Content-Type -> 415, size -> 413, timeout -> 408, JSON -> 400
 *
 * @param {{
 *   config: ReturnType<typeof import('../../config/config.js').loadConfig>,
 *   services: {
 *     health: ReturnType<typeof import('../../application/healthService.js').createHealthService>,
 *     translate: ReturnType<typeof import('../../application/translateService.js').createTranslateService>,
 *   },
 *   logger: ReturnType<typeof import('../logging/logger.js').createLogger>,
 *   authenticator?: ReturnType<typeof import('./auth.js').createAuthenticator>,
 *   rateLimiter?: ReturnType<typeof import('./rateLimiter.js').createRateLimiter> | null,
 * }} deps
 */
export function createServer({ config, services, logger, authenticator = AUTH_NOT_ENFORCED, rateLimiter = null }) {
  // An absent/empty allowlist means: no browser origin is accepted at all.
  const cors = createCorsPolicy(config.cors?.allowedOrigins ?? []);

  const routes = {
    '/health': {
      GET: async () => ({ status: 200, body: services.health.getHealth() }),
    },
    '/v1/translate': {
      POST: async (req) => {
        const body = await readJsonBody(req, {
          maxBytes: config.server.maxBodyBytes,
          timeoutMs: config.server.requestTimeoutMs,
        });
        const checked = validateTranslateRequest(body, config.limits);
        if (!checked.ok) {
          throw new AppError(400, 'INVALID_REQUEST', 'Request validation failed.', checked.details);
        }
        const result = await services.translate.translate(checked.value);
        return { status: 200, body: result };
      },
    },
  };

  const server = http.createServer(async (req, res) => {
    const requestId = randomUUID();
    const startedAt = process.hrtime.bigint();
    let pathname = '/';
    let status = 500;
    let rateHeaders = {};
    let corsHeaders = {};

    try {
      pathname = new URL(req.url ?? '/', 'http://localhost').pathname;

      // 1. CORS origin check. No Origin header (native Android) passes through
      //    untouched. `null`, unknown origins, and every origin when the
      //    allowlist is empty are rejected before anything else runs.
      const origin = cors.evaluate(req);
      if (origin.type === 'denied') {
        // The rejected origin value is not logged.
        logger.warn('origin rejected', { requestId });
        throw new AppError(403, 'ORIGIN_NOT_ALLOWED', 'Origin not allowed.', undefined, { connection: 'close' });
      }
      if (origin.type === 'allowed') {
        corsHeaders = origin.headers;
      }

      // 2. Route lookup.
      const route = routes[pathname];
      if (!route) {
        throw new AppError(404, 'NOT_FOUND', 'Route not found.');
      }

      // 3. CORS preflight: answered here, before authentication and rate
      //    limiting (browsers never send Authorization on a preflight, and a
      //    preflight must not consume the client's rate-limit budget).
      if (origin.type === 'allowed' && cors.isPreflight(req)) {
        const outcome = cors.preflight(req, origin.origin, Object.keys(route));
        if (!outcome.ok) {
          logger.warn('cors preflight rejected', { requestId });
          throw new AppError(403, 'CORS_PREFLIGHT_REJECTED', 'CORS preflight request rejected.');
        }
        status = 204;
        sendNoContent(res, { ...outcome.headers, 'x-request-id': requestId });
        return;
      }

      // 4. Method check.
      const handler = route[req.method ?? ''];
      if (!handler) {
        throw new AppError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.', undefined, {
          allow: Object.keys(route).join(', '),
        });
      }
      // 5. Authenticate BEFORE the handler runs: no body parsing, validation or
      // provider call ever happens for an unauthenticated request.
      if (PROTECTED_PATHS.has(pathname)) {
        const outcome = authenticator.authenticate(req);
        if (!outcome.ok) {
          // Reason category only; never the header or any token value.
          logger.warn('authentication failed', { requestId, reason: outcome.reason });
          throw unauthorizedError();
        }
      }
      // 6. Rate limiting runs AFTER authentication on purpose: only requests that
      // carry a valid token create/consume limiter records, so unauthenticated
      // traffic cannot fill the limiter's memory. Failures here also stop the
      // request before the handler, so the translation provider is never called.
      if (rateLimiter && PROTECTED_PATHS.has(pathname)) {
        const decision = rateLimiter.check(resolveClientIp(req, config.rateLimit.trustedProxyHops));
        rateHeaders = {
          'ratelimit-limit': String(decision.limit),
          'ratelimit-remaining': String(decision.remaining),
          'ratelimit-reset': String(decision.resetSeconds),
        };
        if (!decision.allowed) {
          // No client address or token is logged.
          logger.warn('rate limit exceeded', { requestId });
          throw new AppError(429, 'RATE_LIMITED', 'Too many requests.', undefined, {
            ...rateHeaders,
            'retry-after': String(decision.retryAfterSeconds),
            connection: 'close',
          });
        }
      }
      // 7. Handler (body protection lives in httpProtection.js).
      const result = await handler(req);
      status = result.status;
      sendJson(res, status, result.body, { ...corsHeaders, ...rateHeaders, 'x-request-id': requestId });
    } catch (err) {
      // Phase 05-B3: every error leaves through toClientError() (errorResponse.js).
      // Non-AppError -> generic 500; AppError >= 500 keeps only status + code
      // (fixed message, no details / headers), so a provider can never leak
      // upstream text; AppError < 500 stays client-safe and is redacted.
      const clientError = toClientError(err);
      if (!(err instanceof AppError)) {
        // Bounded, redacted name/message only; never the stack, request or any secret.
        logger.error('unhandled error', { requestId, ...describeError(err) });
      } else if (clientError.status >= 500) {
        // Status and stable code only: the AppError message is never logged here.
        logger.error('server error', { requestId, status: clientError.status, code: clientError.code });
      }
      status = clientError.status;
      const error = { code: clientError.code, message: clientError.message, requestId };
      if (clientError.details) error.details = clientError.details;
      // CORS headers are included on errors too, so an allowed browser origin
      // can read 401 / 413 / 415 / 429 responses instead of an opaque failure.
      sendJson(res, status, { error }, { ...corsHeaders, ...rateHeaders, ...clientError.headers, 'x-request-id': requestId });
    } finally {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      logger.info('request', { requestId, method: req.method, path: pathname, status, durationMs: Math.round(durationMs) });
    }
  });

  server.requestTimeout = config.server.requestTimeoutMs;
  server.headersTimeout = Math.min(60_000, config.server.requestTimeoutMs);

  return server;
}

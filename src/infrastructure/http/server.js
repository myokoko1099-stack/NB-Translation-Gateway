import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { AppError } from '../../domain/errors.js';
import { validateTranslateRequest } from '../../domain/translation.js';
import { unauthorizedError } from './auth.js';

const BASE_HEADERS = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
});

/** Routes that require a valid Bearer token. /health stays public. */
const PROTECTED_PATHS = new Set(['/v1/translate']);

const AUTH_NOT_ENFORCED = Object.freeze({ enabled: false, authenticate: () => ({ ok: true }) });

function sendJson(res, status, payload, extraHeaders) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    ...BASE_HEADERS,
    'content-length': Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

/** Read and parse a JSON body with a hard size limit. */
async function readJsonBody(req, maxBytes) {
  const contentType = req.headers['content-type'] ?? '';
  if (!/^application\/json\s*(;|$)/i.test(contentType)) {
    throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json.', undefined, {
      connection: 'close',
    });
  }

  const declared = req.headers['content-length'];
  if (declared !== undefined && Number(declared) > maxBytes) {
    throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.', undefined, { connection: 'close' });
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.', undefined, { connection: 'close' });
    }
    chunks.push(chunk);
  }

  if (size === 0) {
    throw new AppError(400, 'INVALID_JSON', 'Request body is required.');
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AppError(400, 'INVALID_JSON', 'Request body is not valid JSON.');
  }
}

/**
 * Build (but do not start) the HTTP server.
 *
 * @param {{
 *   config: ReturnType<typeof import('../../config/config.js').loadConfig>,
 *   services: {
 *     health: ReturnType<typeof import('../../application/healthService.js').createHealthService>,
 *     translate: ReturnType<typeof import('../../application/translateService.js').createTranslateService>,
 *   },
 *   logger: ReturnType<typeof import('../logging/logger.js').createLogger>,
 *   authenticator?: ReturnType<typeof import('./auth.js').createAuthenticator>,
 * }} deps
 */
export function createServer({ config, services, logger, authenticator = AUTH_NOT_ENFORCED }) {
  const routes = {
    '/health': {
      GET: async () => ({ status: 200, body: services.health.getHealth() }),
    },
    '/v1/translate': {
      POST: async (req) => {
        const body = await readJsonBody(req, config.server.maxBodyBytes);
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

    try {
      pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
      const route = routes[pathname];
      if (!route) {
        throw new AppError(404, 'NOT_FOUND', 'Route not found.');
      }
      const handler = route[req.method ?? ''];
      if (!handler) {
        throw new AppError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.', undefined, {
          allow: Object.keys(route).join(', '),
        });
      }
      // Authenticate BEFORE the handler runs: no body parsing, validation or
      // provider call ever happens for an unauthenticated request.
      if (PROTECTED_PATHS.has(pathname)) {
        const outcome = authenticator.authenticate(req);
        if (!outcome.ok) {
          // Reason category only; never the header or any token value.
          logger.warn('authentication failed', { requestId, reason: outcome.reason });
          throw unauthorizedError();
        }
      }
      const result = await handler(req);
      status = result.status;
      sendJson(res, status, result.body, { 'x-request-id': requestId });
    } catch (err) {
      let appError;
      if (err instanceof AppError) {
        appError = err;
      } else {
        // Log name/message only; never the request or any secret.
        logger.error('unhandled error', { requestId, errorName: err?.name, errorMessage: err?.message });
        appError = new AppError(500, 'INTERNAL_ERROR', 'Internal server error.');
      }
      status = appError.status;
      const error = { code: appError.code, message: appError.message, requestId };
      if (appError.details) error.details = appError.details;
      sendJson(res, status, { error }, { ...appError.headers, 'x-request-id': requestId });
    } finally {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      logger.info('request', { requestId, method: req.method, path: pathname, status, durationMs: Math.round(durationMs) });
    }
  });

  server.requestTimeout = config.server.requestTimeoutMs;
  server.headersTimeout = Math.min(60_000, config.server.requestTimeoutMs);

  return server;
}

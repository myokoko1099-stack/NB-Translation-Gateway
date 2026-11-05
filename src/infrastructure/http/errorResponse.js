import { AppError } from '../../domain/errors.js';
import { redactString } from '../logging/redact.js';

/**
 * Phase 05-B2.4: error sanitisation for HTTP responses.
 *
 * Rules:
 *  - Anything that is not an AppError (TypeError, provider SDK errors, thrown
 *    strings/objects, ...) becomes a generic 500. Its message, stack, name and
 *    properties are never sent to the client.
 *  - An AppError with status >= 500 keeps only its status and (well-formed)
 *    code; the message is replaced by a fixed generic text, and details and
 *    extra headers are dropped. A future provider adapter therefore cannot leak
 *    upstream error text by wrapping it in an AppError.
 *  - An AppError with status < 500 is a deliberate, client-safe error
 *    (validation, auth, rate limit, ...). Its text still passes through the
 *    redactor as defence in depth; its headers (WWW-Authenticate, Retry-After,
 *    Allow, Connection, ...) are kept.
 */

export const INTERNAL_ERROR_MESSAGE = 'Internal server error.';

const GENERIC_SERVER_MESSAGES = Object.freeze({
  500: INTERNAL_ERROR_MESSAGE,
  501: 'Not implemented.',
  502: 'Upstream service error.',
  503: 'Service unavailable.',
  504: 'Upstream service timed out.',
});

const CODE_FORMAT = /^[A-Z][A-Z0-9_]{0,63}$/;

/**
 * @typedef {object} ClientError
 * @property {number} status
 * @property {string} code
 * @property {string} message
 * @property {Array<Record<string, unknown>>} [details]
 * @property {Record<string, string>} [headers]
 */

/** @returns {ClientError} */
function internal() {
  return { status: 500, code: 'INTERNAL_ERROR', message: INTERNAL_ERROR_MESSAGE };
}

/**
 * Convert any thrown value into what may be sent to the client.
 *
 * @param {unknown} err
 * @returns {ClientError}
 */
export function toClientError(err) {
  if (!(err instanceof AppError)) return internal();

  const status = Number.isInteger(err.status) && err.status >= 400 && err.status <= 599 ? err.status : 500;

  if (status >= 500) {
    return {
      status,
      code: typeof err.code === 'string' && CODE_FORMAT.test(err.code) ? err.code : 'INTERNAL_ERROR',
      message: GENERIC_SERVER_MESSAGES[status] ?? INTERNAL_ERROR_MESSAGE,
    };
  }

  const safe = {
    status,
    code: typeof err.code === 'string' && CODE_FORMAT.test(err.code) ? err.code : 'ERROR',
    message: redactString(typeof err.message === 'string' ? err.message : ''),
  };
  if (Array.isArray(err.details)) {
    safe.details = err.details.map((detail) => {
      const out = {};
      for (const [key, value] of Object.entries(detail ?? {})) {
        out[key] = typeof value === 'string' ? redactString(value) : value;
      }
      return out;
    });
  }
  if (err.headers) safe.headers = err.headers;
  return safe;
}

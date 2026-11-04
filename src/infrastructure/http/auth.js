import { createHash, timingSafeEqual } from 'node:crypto';
import { AppError } from '../../domain/errors.js';

// "Bearer" scheme (case-insensitive), exactly one space, one non-empty token
// without whitespace.
const BEARER = /^Bearer ([^\s]+)$/i;

/** SHA-256 so both sides are equal length for timingSafeEqual. */
function digest(value) {
  return createHash('sha256').update(value, 'utf8').digest();
}

/**
 * Same response for every failure reason: the client must not learn whether
 * the header was missing, malformed or the token wrong. Never contains a token.
 */
export function unauthorizedError() {
  return new AppError(401, 'UNAUTHORIZED', 'Authentication required.', undefined, {
    'www-authenticate': 'Bearer',
    connection: 'close',
  });
}

/**
 * @param {import('../../config/auth.js').AuthConfig} auth
 * @returns {{ enabled: boolean,
 *             authenticate: (req: import('node:http').IncomingMessage) =>
 *               { ok: true } | { ok: false, reason: 'missing' | 'malformed' | 'invalid' } }}
 */
export function createAuthenticator(auth) {
  if (!auth.enabled) {
    return { enabled: false, authenticate: () => ({ ok: true }) };
  }
  const expected = digest(auth.token.reveal());

  return {
    enabled: true,
    authenticate(req) {
      const header = req.headers.authorization;
      if (header === undefined) return { ok: false, reason: 'missing' };
      const match = BEARER.exec(header);
      if (!match) return { ok: false, reason: 'malformed' };
      if (!timingSafeEqual(digest(match[1]), expected)) return { ok: false, reason: 'invalid' };
      return { ok: true };
    },
  };
}

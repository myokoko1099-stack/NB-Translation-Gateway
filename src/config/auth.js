import { ConfigError } from '../domain/errors.js';

/** Name of the environment variable holding the client Bearer token. */
export const CLIENT_TOKEN_VAR = 'GATEWAY_CLIENT_TOKEN';

// Printable ASCII, no whitespace: safe inside an Authorization header.
const TOKEN_CHARS = /^[\x21-\x7E]+$/;

/**
 * @typedef {object} AuthConfig
 * @property {boolean} enabled
 * @property {import('./secrets.js').Secret | null} token
 */

/** Auth that is not enforced (development / test only). */
export const AUTH_DISABLED = Object.freeze({ enabled: false, token: null });

/**
 * Resolve client-authentication settings from the secret provider.
 *
 * - production: the token is REQUIRED; missing/empty -> ConfigError (startup fails).
 * - development / test: when unset, authentication is not enforced (B1 behaviour).
 * - a token that is set but malformed (whitespace / non-printable) always fails.
 *
 * Errors name the variable only, never its value.
 *
 * @param {{ env: string }} config
 * @param {import('./secrets.js').SecretProvider} secrets
 * @returns {AuthConfig}
 * @throws {ConfigError}
 */
export function loadAuthConfig(config, secrets) {
  const secret = config.env === 'production' ? secrets.require(CLIENT_TOKEN_VAR) : secrets.get(CLIENT_TOKEN_VAR);
  if (!secret) {
    return AUTH_DISABLED;
  }
  if (!TOKEN_CHARS.test(secret.reveal())) {
    throw new ConfigError([`${CLIENT_TOKEN_VAR} must be non-empty printable ASCII without whitespace`]);
  }
  return Object.freeze({ enabled: true, token: secret });
}

import { ConfigError } from '../domain/errors.js';
import { CLIENT_TOKEN_VAR } from './auth.js';

/**
 * Phase 05-B2.4: production configuration hardening (written and unit-tested).
 * Phase 05-B4: ACTIVATED. src/index.js calls assertProductionConfig() right
 * after loadConfig() and loadAuthConfig(), so a production process with an
 * unacceptable configuration exits 1 before the logger, the provider or the
 * HTTP server are created.
 *
 * Only NODE_ENV=production is checked; development and test are untouched.
 * It introduces no new environment variable. Problems name the variable and
 * the reason only - never a value (no token, and no part of one).
 */

/** Shortest client token accepted in production (Phase 05-B4). */
export const MIN_CLIENT_TOKEN_LENGTH = 16;

/** Obvious placeholder values that must never be used as the client token. */
const PLACEHOLDER_TOKENS = new Set([
  'changeme',
  'change-me',
  'change_me',
  'replace-me',
  'replaceme',
  'your-token',
  'your_token',
  'yourtoken',
  'your-token-here',
  'token',
  'secret',
  'password',
  'example',
  'placeholder',
  'test',
  'todo',
  'xxx',
  'xxxx',
]);

/** `<set-in-hosting-dashboard>` or `${GATEWAY_CLIENT_TOKEN}` copied from docs / templates. */
function looksLikePlaceholder(value) {
  return /^<.*>$/.test(value) || /^\$\{.*\}$/.test(value) || PLACEHOLDER_TOKENS.has(value.toLowerCase());
}

/** A token such as "aaaaaaaaaaaaaaaa" or "0000000000000000" carries no entropy. */
function isSingleRepeatedCharacter(value) {
  return new Set(value).size === 1;
}

/**
 * @param {{ env: string, logLevel: string }} config
 * @param {import('./auth.js').AuthConfig} auth
 * @returns {string[]} one entry per problem (empty when the configuration is acceptable)
 */
export function collectProductionProblems(config, auth) {
  if (config.env !== 'production') return [];

  const problems = [];

  if (!auth || !auth.enabled || !auth.token) {
    problems.push(`${CLIENT_TOKEN_VAR} is required`);
  } else {
    const token = auth.token.reveal();
    if (looksLikePlaceholder(token)) {
      problems.push(`${CLIENT_TOKEN_VAR} must not be a placeholder value`);
    } else if (token.length < MIN_CLIENT_TOKEN_LENGTH) {
      problems.push(`${CLIENT_TOKEN_VAR} must be at least ${MIN_CLIENT_TOKEN_LENGTH} characters`);
    } else if (isSingleRepeatedCharacter(token)) {
      problems.push(`${CLIENT_TOKEN_VAR} must not be a single repeated character`);
    }
  }

  if (config.logLevel === 'debug') {
    problems.push('LOG_LEVEL must not be "debug" in production');
  }

  return problems;
}

/**
 * @param {{ env: string, logLevel: string }} config
 * @param {import('./auth.js').AuthConfig} auth
 * @throws {ConfigError} listing every problem found (production only)
 */
export function assertProductionConfig(config, auth) {
  const problems = collectProductionProblems(config, auth);
  if (problems.length > 0) {
    throw new ConfigError(problems);
  }
}

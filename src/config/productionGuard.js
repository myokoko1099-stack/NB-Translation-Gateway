import { ConfigError } from '../domain/errors.js';
import { CLIENT_TOKEN_VAR } from './auth.js';

/**
 * Phase 05-B2.4: production configuration hardening.
 *
 * Runs at startup (src/index.js) AFTER loadConfig() and loadAuthConfig().
 * Only NODE_ENV=production is checked; development and test are untouched.
 * It introduces no new environment variable. Problems name the variable and
 * the reason only - never a value.
 */

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
  } else if (looksLikePlaceholder(auth.token.reveal())) {
    problems.push(`${CLIENT_TOKEN_VAR} must not be a placeholder value`);
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

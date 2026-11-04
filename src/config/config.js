import { ConfigError } from '../domain/errors.js';
import { SERVICE_NAME, VERSION } from '../meta.js';
import { LOG_LEVELS, PROFILES } from './profiles.js';

/**
 * Parse an optional integer variable. Pushes a problem (variable NAME and
 * reason only - never the raw value) when it is present but invalid.
 */
function intVar(env, name, fallback, { min, max }, problems) {
  const raw = env[name];
  if (raw === undefined || raw === '') {
    if (fallback === null) {
      problems.push(`${name} is required`);
    }
    return fallback;
  }
  if (!/^\d+$/.test(raw)) {
    problems.push(`${name} must be a non-negative integer`);
    return fallback;
  }
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < min || n > max) {
    problems.push(`${name} must be between ${min} and ${max}`);
    return fallback;
  }
  return n;
}

/**
 * Build the immutable runtime configuration from an environment map.
 * Pure function: pass `process.env` in production, a plain object in tests.
 * Secrets are NOT part of this object; see SecretProvider.
 *
 * @param {Record<string, string | undefined>} env
 * @throws {ConfigError} listing every problem found
 */
export function loadConfig(env) {
  const problems = [];

  const envName = env.NODE_ENV === undefined || env.NODE_ENV === '' ? 'development' : env.NODE_ENV;
  const profile = PROFILES[envName];
  if (!profile) {
    throw new ConfigError([
      `NODE_ENV must be one of: ${Object.keys(PROFILES).join(', ')}`,
    ]);
  }

  const port = intVar(env, 'PORT', profile.port, { min: 0, max: 65535 }, problems);
  const maxBodyBytes = intVar(env, 'MAX_BODY_BYTES', profile.maxBodyBytes, { min: 1, max: 10_485_760 }, problems);
  const requestTimeoutMs = intVar(env, 'REQUEST_TIMEOUT_MS', profile.requestTimeoutMs, { min: 1000, max: 600_000 }, problems);
  const maxTextChars = intVar(env, 'MAX_TEXT_CHARS', profile.maxTextChars, { min: 1, max: 1_000_000 }, problems);

  const host = env.HOST === undefined || env.HOST === '' ? profile.host : env.HOST;
  if (!/^[A-Za-z0-9.:_-]+$/.test(host)) {
    problems.push('HOST contains invalid characters');
  }

  const logLevel = env.LOG_LEVEL === undefined || env.LOG_LEVEL === '' ? profile.logLevel : env.LOG_LEVEL;
  if (!LOG_LEVELS.includes(logLevel)) {
    problems.push(`LOG_LEVEL must be one of: ${LOG_LEVELS.join(', ')}`);
  }

  if (problems.length > 0) {
    throw new ConfigError(problems);
  }

  return Object.freeze({
    service: SERVICE_NAME,
    version: VERSION,
    env: envName,
    logLevel,
    server: Object.freeze({ host, port, requestTimeoutMs, maxBodyBytes }),
    limits: Object.freeze({ maxTextChars }),
  });
}

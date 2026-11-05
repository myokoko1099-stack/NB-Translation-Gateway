import { ConfigError } from '../domain/errors.js';
import { SERVICE_NAME, VERSION } from '../meta.js';
import { LOG_LEVELS, PROFILES } from './profiles.js';

/** Name of the environment variable holding the CORS origin allowlist (Phase 05-B2.3). */
export const CORS_ORIGINS_VAR = 'GATEWAY_CORS_ALLOWED_ORIGINS';

const MAX_CORS_ORIGINS = 50;
const MAX_CORS_ORIGIN_LENGTH = 255;

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
 * A valid allowlist entry is a bare, canonical http(s) origin exactly as a
 * browser serialises it: scheme://host[:port], lowercase, no path, no query,
 * no trailing slash, no userinfo, no default port, no wildcard.
 */
function isCanonicalOrigin(entry) {
  if (entry.length > MAX_CORS_ORIGIN_LENGTH || entry.includes('*')) return false;
  let url;
  try {
    url = new URL(entry);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  return url.origin === entry;
}

/**
 * Parse GATEWAY_CORS_ALLOWED_ORIGINS (comma-separated origins).
 * Unset / blank -> empty list (no browser origin is allowed; native clients
 * without an Origin header are unaffected). Problems name the variable and the
 * entry position only, never the entry value.
 */
function originList(env, problems) {
  const raw = env[CORS_ORIGINS_VAR];
  if (raw === undefined || raw.trim() === '') return Object.freeze([]);

  const entries = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  if (entries.length > MAX_CORS_ORIGINS) {
    problems.push(`${CORS_ORIGINS_VAR} must list at most ${MAX_CORS_ORIGINS} origins`);
    return Object.freeze([]);
  }

  const origins = new Set();
  entries.forEach((entry, index) => {
    if (isCanonicalOrigin(entry)) {
      origins.add(entry);
    } else {
      problems.push(
        `${CORS_ORIGINS_VAR} entry ${index + 1} must be an exact origin such as https://example.com[:port] ` +
          '(http/https only; no wildcard, path, trailing slash or "null")',
      );
    }
  });
  return Object.freeze([...origins]);
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

  const rateLimitMax = intVar(env, 'GATEWAY_RATE_LIMIT_MAX', profile.rateLimitMax, { min: 1, max: 100_000 }, problems);
  const rateLimitWindowMs = intVar(
    env,
    'GATEWAY_RATE_LIMIT_WINDOW_MS',
    profile.rateLimitWindowMs,
    { min: 1000, max: 3_600_000 },
    problems,
  );
  const trustedProxyHops = intVar(env, 'GATEWAY_TRUSTED_PROXY_HOPS', profile.trustedProxyHops, { min: 0, max: 10 }, problems);

  const corsAllowedOrigins = originList(env, problems);

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
    rateLimit: Object.freeze({ max: rateLimitMax, windowMs: rateLimitWindowMs, trustedProxyHops }),
    cors: Object.freeze({ allowedOrigins: corsAllowedOrigins }),
  });
}

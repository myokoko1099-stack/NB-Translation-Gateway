import { Secret } from '../../config/secrets.js';

/**
 * Phase 05-B2.4: secret / sensitive-data redaction for logs and error text.
 *
 * Pure functions, no dependencies. Used by the logger (every line) and by
 * the HTTP error layer. Two complementary strategies:
 *
 *   1. By NAME  - object keys such as `authorization`, `cookie`, `x-api-key`,
 *                 anything ending in token / secret / password / apikey.
 *   2. By SHAPE - Bearer tokens, `Authorization:` header text, `?key=` URL
 *                 parameters, key=value / "key":"value" pairs, well-known
 *                 credential formats, JWTs and PEM private keys.
 *
 * The logger can additionally scrub the EXACT values of known secrets
 * (see createRedactor({ secrets })), which also covers a token that has no
 * recognisable shape.
 */

export const REDACTED = '[REDACTED]';

const MAX_DEPTH = 6;
const MAX_ARRAY_ITEMS = 100;
const MAX_ERROR_NAME = 100;
const MAX_ERROR_MESSAGE = 500;
const MIN_EXACT_SECRET_LENGTH = 6;

/** Normalised (lower-case, letters+digits only) key names that are always sensitive. */
const SENSITIVE_KEYS = new Set([
  'authorization',
  'proxyauthorization',
  'cookie',
  'setcookie',
  'apikey',
  'xapikey',
  'xgoogapikey',
  'bearer',
]);
const SENSITIVE_KEY_SUFFIX = /(apikey|secret|password|passwd|token|credential|credentials|privatekey)$/;

/** @param {string} key */
export function isSensitiveKey(key) {
  const normalised = String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
  return SENSITIVE_KEYS.has(normalised) || SENSITIVE_KEY_SUFFIX.test(normalised);
}

const KEY_NAMES = 'api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|secret|password|passwd|token';

/** Order matters: header text first, then Bearer, then structured pairs, then raw formats. */
const PATTERNS = [
  // PEM private key blocks (also when truncated before the END line).
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, REDACTED],
  // `Authorization: <anything>` / `Cookie: ...` / `x-goog-api-key: ...` (also quoted / JSON form).
  [
    /\b(authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-goog-api-key)(["']?\s*[:=]\s*["']?)[^"'\r\n]+/gi,
    `$1$2${REDACTED}`,
  ],
  // `Bearer <token>` anywhere in a string.
  [/\bBearer\s+[^\s"',;]+/gi, `Bearer ${REDACTED}`],
  // `Basic <base64>` (long values only, so ordinary prose is left alone).
  [/\bBasic\s+[A-Za-z0-9+/]{16,}={0,2}/g, `Basic ${REDACTED}`],
  // URL / form parameters: ?key=..., &api_key=..., &access_token=...
  [
    new RegExp(`(^|[?&;\\s"'])((?:key|auth|signature|sig|${KEY_NAMES})=)[^&\\s"'#]+`, 'gi'),
    `$1$2${REDACTED}`,
  ],
  // key=value / "key": "value" pairs.
  [new RegExp(`(["']?(?:${KEY_NAMES})["']?\\s*[:=]\\s*)(["']?)[^"'\\s,;}&]+`, 'gi'), `$1$2${REDACTED}`],
  // Well-known credential formats.
  [/AIza[0-9A-Za-z_-]{20,}/g, REDACTED],
  [/\bsk-[A-Za-z0-9_-]{20,}/g, REDACTED],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, REDACTED],
  [/\bAKIA[0-9A-Z]{16}\b/g, REDACTED],
  // JSON Web Tokens.
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, REDACTED],
];

/** @param {string} text */
function redactByShape(text) {
  let out = text;
  for (const [pattern, replacement] of PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/**
 * Exact-value scrubbing for known secrets. Values shorter than
 * MIN_EXACT_SECRET_LENGTH are skipped (they would mangle ordinary text);
 * shape-based redaction still applies to them.
 *
 * @param {Array<Secret | string | null | undefined>} secrets
 * @returns {string[]}
 */
function exactValues(secrets) {
  const values = new Set();
  for (const item of secrets) {
    let raw;
    if (item instanceof Secret) raw = item.reveal();
    else if (typeof item === 'string') raw = item;
    if (typeof raw !== 'string' || raw.length < MIN_EXACT_SECRET_LENGTH) continue;
    values.add(raw);
    const encoded = encodeURIComponent(raw);
    if (encoded !== raw) values.add(encoded);
  }
  // Longest first so a value that contains another is replaced as a whole.
  return [...values].sort((a, b) => b.length - a.length);
}

/**
 * Build a redactor. `secrets` (optional) are Secret wrappers or strings whose
 * exact values must never appear in output.
 *
 * @param {{ secrets?: Array<Secret | string | null | undefined> }} [options]
 */
export function createRedactor({ secrets = [] } = {}) {
  const known = exactValues(secrets);

  /** @param {string} text */
  function string(text) {
    let out = String(text);
    for (const value of known) {
      if (out.includes(value)) out = out.split(value).join(REDACTED);
    }
    return redactByShape(out);
  }

  /**
   * Deep-copy `input` into a JSON-safe structure with sensitive keys and
   * secret-looking strings redacted. Errors become { name, message } only
   * (never the stack). Secret wrappers become '[REDACTED]'.
   */
  function value(input, depth = 0, seen = new WeakSet()) {
    if (input instanceof Secret) return REDACTED;
    switch (typeof input) {
      case 'string':
        return string(input);
      case 'number':
      case 'boolean':
      case 'undefined':
        return input;
      case 'bigint':
        return input.toString();
      case 'function':
      case 'symbol':
        return undefined;
      default:
        break;
    }
    if (input === null) return null;
    if (depth >= MAX_DEPTH) return '[Truncated]';
    if (seen.has(input)) return '[Circular]';
    seen.add(input);
    try {
      if (input instanceof Error) {
        return { name: string(input.name), message: string(input.message) };
      }
      if (Array.isArray(input)) {
        return input.slice(0, MAX_ARRAY_ITEMS).map((item) => value(item, depth + 1, seen));
      }
      if (typeof input.toJSON === 'function') {
        return value(input.toJSON(), depth + 1, seen);
      }
      const out = {};
      for (const [key, item] of Object.entries(input)) {
        out[key] = isSensitiveKey(key) ? REDACTED : value(item, depth + 1, seen);
      }
      return out;
    } finally {
      seen.delete(input);
    }
  }

  return { string, value };
}

const defaultRedactor = createRedactor();

/**
 * Redact secret-looking content in a string (shape-based only).
 * @param {string} text
 */
export function redactString(text) {
  return defaultRedactor.string(text);
}

/**
 * Redact a value for logging (shape- and name-based only).
 * @param {unknown} input
 */
export function redactValue(input) {
  return defaultRedactor.value(input);
}

/**
 * Safe, bounded description of anything that was thrown, for log fields.
 * Name and message only - never the stack, never the cause, never other
 * properties (provider errors often carry request headers or URLs).
 *
 * @param {unknown} err
 * @returns {{ errorName: string, errorMessage: string }}
 */
export function describeError(err) {
  const name = typeof err?.name === 'string' && err.name !== '' ? err.name : typeof err;
  let message = '';
  if (err instanceof Error) message = err.message;
  else if (typeof err === 'string') message = err;
  return {
    errorName: redactString(name).slice(0, MAX_ERROR_NAME),
    errorMessage: redactString(String(message)).slice(0, MAX_ERROR_MESSAGE),
  };
}

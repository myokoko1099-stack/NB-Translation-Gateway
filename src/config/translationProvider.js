import { ConfigError } from '../domain/errors.js';

/**
 * Phase 05-B3: translation provider configuration.
 *
 * This is the ONLY module allowed to read the Gemini credential
 * (test/secret-exposure.test.js enforces that). The key is read through the
 * SecretProvider, so it is a `Secret` wrapper from the moment it is loaded and
 * never appears in logs, JSON or string conversion.
 *
 * Environment variables:
 *   TRANSLATION_PROVIDER  none | gemini        (default: none)
 *   GEMINI_API_KEY        required when TRANSLATION_PROVIDER=gemini
 *   GEMINI_MODEL          default DEFAULT_GEMINI_MODEL
 *   GEMINI_TIMEOUT_MS     default 30000 (1000 - 120000)
 *
 * With TRANSLATION_PROVIDER=none (or unset) the Gemini variables are not read
 * or validated at all, and POST /v1/translate keeps answering 501.
 * Problems name the variable only, never its value.
 */

export const PROVIDER_VAR = 'TRANSLATION_PROVIDER';
export const GEMINI_API_KEY_VAR = 'GEMINI_API_KEY';
export const GEMINI_MODEL_VAR = 'GEMINI_MODEL';
export const GEMINI_TIMEOUT_VAR = 'GEMINI_TIMEOUT_MS';

export const PROVIDER_NONE = 'none';
export const PROVIDER_GEMINI = 'gemini';
export const PROVIDER_IDS = Object.freeze([PROVIDER_NONE, PROVIDER_GEMINI]);

/** The single place the default model id lives. */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite';
export const DEFAULT_GEMINI_TIMEOUT_MS = 30_000;

const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 120_000;
const MODEL_FORMAT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
// Printable ASCII, no whitespace: safe inside an HTTP header value.
const API_KEY_FORMAT = /^[\x21-\x7E]{1,512}$/;

/**
 * @typedef {object} GeminiConfig
 * @property {import('./secrets.js').Secret} apiKey
 * @property {string} model
 * @property {number} timeoutMs
 *
 * @typedef {object} TranslationProviderConfig
 * @property {'none' | 'gemini'} provider
 * @property {GeminiConfig | null} gemini
 */

/** @type {TranslationProviderConfig} */
const NONE = Object.freeze({ provider: PROVIDER_NONE, gemini: null });

/**
 * @param {Record<string, string | undefined>} env
 * @param {import('./secrets.js').SecretProvider} secrets
 * @returns {TranslationProviderConfig}
 * @throws {ConfigError} listing every problem found
 */
export function loadTranslationProviderConfig(env, secrets) {
  const rawProvider = env[PROVIDER_VAR];
  const name = rawProvider === undefined || rawProvider.trim() === '' ? PROVIDER_NONE : rawProvider.trim().toLowerCase();

  if (!PROVIDER_IDS.includes(name)) {
    throw new ConfigError([`${PROVIDER_VAR} must be one of: ${PROVIDER_IDS.join(', ')}`]);
  }
  if (name === PROVIDER_NONE) {
    // Gemini variables are intentionally not looked at.
    return NONE;
  }

  const problems = [];

  const apiKey = secrets.get(GEMINI_API_KEY_VAR);
  if (!apiKey) {
    problems.push(`${GEMINI_API_KEY_VAR} is required when ${PROVIDER_VAR}=${PROVIDER_GEMINI}`);
  } else if (!API_KEY_FORMAT.test(apiKey.reveal())) {
    problems.push(`${GEMINI_API_KEY_VAR} must be non-empty printable ASCII without whitespace (at most 512 characters)`);
  }

  let model = DEFAULT_GEMINI_MODEL;
  const rawModel = env[GEMINI_MODEL_VAR];
  if (rawModel !== undefined && rawModel !== '') {
    if (MODEL_FORMAT.test(rawModel)) {
      model = rawModel;
    } else {
      problems.push(`${GEMINI_MODEL_VAR} must be a model id of letters, digits, ".", "_" or "-" (at most 64 characters)`);
    }
  }

  let timeoutMs = DEFAULT_GEMINI_TIMEOUT_MS;
  const rawTimeout = env[GEMINI_TIMEOUT_VAR];
  if (rawTimeout !== undefined && rawTimeout !== '') {
    const n = /^\d+$/.test(rawTimeout) ? Number(rawTimeout) : NaN;
    if (Number.isSafeInteger(n) && n >= MIN_TIMEOUT_MS && n <= MAX_TIMEOUT_MS) {
      timeoutMs = n;
    } else {
      problems.push(`${GEMINI_TIMEOUT_VAR} must be an integer between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}`);
    }
  }

  if (problems.length > 0) {
    throw new ConfigError(problems);
  }

  return Object.freeze({
    provider: PROVIDER_GEMINI,
    gemini: Object.freeze({ apiKey, model, timeoutMs }),
  });
}

import { Secret } from '../../config/secrets.js';
import { AppError } from '../../domain/errors.js';
import { buildGeminiPrompt } from './geminiPrompt.js';

/**
 * Phase 05-B3: Gemini Interactions API adapter (implements the
 * TranslationProvider port).
 *
 * Request:  POST {GEMINI_ENDPOINT}  header x-goog-api-key
 *           body { model, input, system_instruction, store: false }
 * Response: steps[] -> the `model_output` steps -> content[] -> text parts.
 *           Only a `completed` interaction is accepted.
 *
 * Safety rules:
 *  - The endpoint is a constant: no configuration value, environment variable
 *    or request field can change it.
 *  - Node's native fetch only; `redirect: 'error'`; one attempt (no retry).
 *  - Every failure becomes an AppError with a fixed, client-safe message. The
 *    upstream status line, body and error text are never copied into the error
 *    or into a log line.
 *  - Neither the request text nor the translation is ever logged.
 */

export const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';
export const GEMINI_PROVIDER_ID = 'gemini';

const MAX_RESPONSE_CHARS = 4_000_000;

const ERRORS = Object.freeze({
  upstream: { status: 502, code: 'UPSTREAM_ERROR', message: 'Upstream service error.' },
  rateLimited: { status: 429, code: 'UPSTREAM_RATE_LIMITED', message: 'Upstream service is rate limited. Try again later.' },
  unavailable: { status: 503, code: 'UPSTREAM_UNAVAILABLE', message: 'Upstream service unavailable.' },
  timeout: { status: 504, code: 'UPSTREAM_TIMEOUT', message: 'Upstream service timed out.' },
});

/** @param {{ status: number, code: string, message: string }} spec */
function toAppError(spec) {
  return new AppError(spec.status, spec.code, spec.message);
}

/**
 * Map an upstream HTTP status to a client-facing error.
 *   400 / 401 / 403 / 404 / 500 and anything else unexpected -> 502 UPSTREAM_ERROR
 *   429 -> 429 UPSTREAM_RATE_LIMITED, 503 -> 503 UPSTREAM_UNAVAILABLE,
 *   504 -> 504 UPSTREAM_TIMEOUT
 * @param {number} status
 */
export function mapUpstreamStatus(status) {
  if (status === 429) return ERRORS.rateLimited;
  if (status === 503) return ERRORS.unavailable;
  if (status === 504) return ERRORS.timeout;
  return ERRORS.upstream;
}

/** @param {unknown} err */
function isTimeout(err) {
  const name = err?.name;
  return name === 'TimeoutError' || name === 'AbortError';
}

/** Low-cardinality, secret-free hint such as ECONNREFUSED (never a message or URL). */
function causeCode(err) {
  const code = err?.cause?.code;
  return typeof code === 'string' && /^[A-Z0-9_]{1,40}$/.test(code) ? code : undefined;
}

/**
 * Pull the translated text out of an Interaction resource.
 * @param {unknown} data parsed JSON
 * @returns {{ ok: true, text: string } | { ok: false, reason: string, interactionStatus?: string }}
 */
function extractTranslation(data) {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, reason: 'invalid_shape' };
  }
  if (data.status !== 'completed') {
    const s = typeof data.status === 'string' && /^[a-z_]{1,32}$/.test(data.status) ? data.status : undefined;
    return { ok: false, reason: 'incomplete', interactionStatus: s };
  }
  if (!Array.isArray(data.steps)) {
    return { ok: false, reason: 'invalid_shape' };
  }

  const outputs = [];
  for (const step of data.steps) {
    if (typeof step !== 'object' || step === null || step.type !== 'model_output' || !Array.isArray(step.content)) {
      continue;
    }
    const parts = [];
    for (const part of step.content) {
      if (typeof part === 'object' && part !== null && part.type === 'text' && typeof part.text === 'string') {
        parts.push(part.text);
      }
    }
    if (parts.length > 0) outputs.push(parts.join(''));
  }

  const text = outputs.join('\n');
  if (text.trim() === '') {
    return { ok: false, reason: 'empty_response' };
  }
  return { ok: true, text };
}

/** @implements {import('../../ports/translationProvider.js').TranslationProvider} */
export class GeminiProvider {
  id = GEMINI_PROVIDER_ID;

  #apiKey;
  #model;
  #timeoutMs;
  #fetch;
  #logger;

  /**
   * @param {{
   *   apiKey: Secret,
   *   model: string,
   *   timeoutMs: number,
   *   fetchImpl?: typeof fetch,
   *   logger?: { warn: (message: string, fields?: object) => void } | null,
   * }} options
   */
  constructor({ apiKey, model, timeoutMs, fetchImpl = globalThis.fetch, logger = null }) {
    if (!(apiKey instanceof Secret)) throw new TypeError('apiKey must be a Secret');
    if (typeof model !== 'string' || model === '') throw new TypeError('model must be a non-empty string');
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new TypeError('timeoutMs must be a positive integer');
    if (typeof fetchImpl !== 'function') throw new TypeError('fetch is not available');
    this.#apiKey = apiKey;
    this.#model = model;
    this.#timeoutMs = timeoutMs;
    this.#fetch = fetchImpl;
    this.#logger = logger;
  }

  /**
   * @param {import('../../domain/translation.js').TranslateRequest} request
   * @returns {Promise<import('../../domain/translation.js').TranslateResult>}
   * @throws {AppError}
   */
  async translate(request) {
    const { systemInstruction, input } = buildGeminiPrompt(request);
    const body = JSON.stringify({
      model: this.#model,
      input,
      system_instruction: systemInstruction,
      store: false,
    });

    const doFetch = this.#fetch;
    let status;
    let text = '';
    try {
      const res = await doFetch(GEMINI_ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'x-goog-api-key': this.#apiKey.reveal(),
        },
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
      status = res.status;
      if (status === 200) {
        text = await res.text();
      } else {
        // The upstream error body is never used; release the connection.
        try {
          await res.body?.cancel();
        } catch {
          /* ignore */
        }
      }
    } catch (err) {
      if (isTimeout(err)) {
        throw this.#fail(ERRORS.timeout, 'timeout');
      }
      throw this.#fail(ERRORS.upstream, 'network', { causeCode: causeCode(err) });
    }

    if (status !== 200) {
      throw this.#fail(mapUpstreamStatus(status), 'http_status', { upstreamStatus: status });
    }
    if (text.length > MAX_RESPONSE_CHARS) {
      throw this.#fail(ERRORS.upstream, 'response_too_large');
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw this.#fail(ERRORS.upstream, 'invalid_json');
    }

    const extracted = extractTranslation(data);
    if (!extracted.ok) {
      throw this.#fail(ERRORS.upstream, extracted.reason, { interactionStatus: extracted.interactionStatus });
    }

    return {
      translatedText: extracted.text,
      sourceLanguage: request.sourceLanguage,
      targetLanguage: request.targetLanguage,
      provider: this.id,
    };
  }

  /**
   * Log a secret-free reason category and return the client-safe error.
   * @param {{ status: number, code: string, message: string }} spec
   * @param {string} reason
   * @param {Record<string, string | number | undefined>} [extra]
   */
  #fail(spec, reason, extra = {}) {
    this.#logger?.warn('translation provider request failed', { provider: this.id, reason, ...extra });
    return toAppError(spec);
  }
}

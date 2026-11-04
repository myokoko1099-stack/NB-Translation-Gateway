/**
 * POST /v1/translate contract (Phase 05-B1: structure only).
 *
 * Request body (JSON, all fields required, no unknown fields):
 *   {
 *     "sourceLanguage": "ja",     // BCP-47-style tag, or "auto"
 *     "targetLanguage": "my",     // BCP-47-style tag (not "auto")
 *     "text": "..."               // non-empty, <= MAX_TEXT_CHARS
 *   }
 *
 * Success response (RESERVED for a later phase - never returned in 05-B1):
 *   {
 *     "requestId": "uuid",
 *     "translatedText": "...",
 *     "sourceLanguage": "ja",
 *     "targetLanguage": "my",
 *     "provider": "<provider id>"
 *   }
 *
 * Error response (all error statuses):
 *   { "error": { "code": "...", "message": "...", "requestId": "uuid",
 *                "details": [{ "field": "text", "issue": "..." }] } }
 *
 * @typedef {object} TranslateRequest
 * @property {string} sourceLanguage
 * @property {string} targetLanguage
 * @property {string} text
 *
 * @typedef {object} TranslateResult
 * @property {string} translatedText
 * @property {string} sourceLanguage
 * @property {string} targetLanguage
 * @property {string} provider
 */

export const TRANSLATE_REQUEST_FIELDS = Object.freeze(['sourceLanguage', 'targetLanguage', 'text']);

const LANGUAGE_TAG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$/;

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Validate a parsed JSON body. Never echoes the submitted text back.
 * @param {unknown} body
 * @param {{ maxTextChars: number }} limits
 * @returns {{ ok: true, value: TranslateRequest } | { ok: false, details: Array<{field?: string, issue: string}> }}
 */
export function validateTranslateRequest(body, limits) {
  if (!isPlainObject(body)) {
    return { ok: false, details: [{ issue: 'body must be a JSON object' }] };
  }

  const details = [];

  for (const key of Object.keys(body)) {
    if (!TRANSLATE_REQUEST_FIELDS.includes(key)) {
      details.push({ field: key, issue: 'unknown field' });
    }
  }

  const { sourceLanguage, targetLanguage, text } = body;

  if (typeof sourceLanguage !== 'string' || sourceLanguage === '') {
    details.push({ field: 'sourceLanguage', issue: 'required string' });
  } else if (sourceLanguage !== 'auto' && !LANGUAGE_TAG.test(sourceLanguage)) {
    details.push({ field: 'sourceLanguage', issue: 'must be a language tag such as "ja" or "zh-CN", or "auto"' });
  }

  if (typeof targetLanguage !== 'string' || targetLanguage === '') {
    details.push({ field: 'targetLanguage', issue: 'required string' });
  } else if (!LANGUAGE_TAG.test(targetLanguage)) {
    details.push({ field: 'targetLanguage', issue: 'must be a language tag such as "my" or "en"' });
  }

  if (typeof text !== 'string') {
    details.push({ field: 'text', issue: 'required string' });
  } else if (text.trim() === '') {
    details.push({ field: 'text', issue: 'must not be empty' });
  } else if (text.length > limits.maxTextChars) {
    details.push({ field: 'text', issue: `must be at most ${limits.maxTextChars} characters` });
  }

  if (details.length > 0) {
    return { ok: false, details };
  }
  return { ok: true, value: { sourceLanguage, targetLanguage, text } };
}

/**
 * Port: any translation backend (Gemini, another LLM, a mock, ...) must
 * implement this shape. The application layer depends ONLY on this port,
 * never on a concrete provider or SDK.
 *
 * @typedef {object} TranslationProvider
 * @property {string} id stable provider identifier, e.g. "gemini"
 * @property {(request: import('../domain/translation.js').TranslateRequest) =>
 *   Promise<import('../domain/translation.js').TranslateResult>} translate
 */

/**
 * Throws TypeError if `candidate` does not satisfy the port.
 * @param {unknown} candidate
 * @returns {TranslationProvider}
 */
export function assertTranslationProvider(candidate) {
  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    typeof candidate.id !== 'string' ||
    typeof candidate.translate !== 'function'
  ) {
    throw new TypeError('TranslationProvider must have a string "id" and a "translate" function');
  }
  return /** @type {TranslationProvider} */ (candidate);
}

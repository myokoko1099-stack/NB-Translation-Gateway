import { AppError } from '../domain/errors.js';
import { assertTranslationProvider } from '../ports/translationProvider.js';

/**
 * Translation use case.
 *
 * Phase 05-B1: no provider is wired in (src/index.js passes none), so every
 * call fails with 501 NOT_IMPLEMENTED. It never returns a fabricated success.
 * A later phase injects a real TranslationProvider here.
 *
 * @param {{ provider?: import('../ports/translationProvider.js').TranslationProvider | null }} [deps]
 */
export function createTranslateService({ provider = null } = {}) {
  const checked = provider === null ? null : assertTranslationProvider(provider);

  return {
    /** @param {import('../domain/translation.js').TranslateRequest} request */
    async translate(request) {
      if (checked === null) {
        throw new AppError(
          501,
          'NOT_IMPLEMENTED',
          'Translation is not implemented in this build (Phase 05-B1 foundation only).',
        );
      }
      return checked.translate(request);
    },
  };
}

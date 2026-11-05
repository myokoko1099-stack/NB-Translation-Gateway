import { PROVIDER_GEMINI, PROVIDER_IDS, PROVIDER_NONE, PROVIDER_VAR } from '../../config/translationProvider.js';
import { ConfigError } from '../../domain/errors.js';
import { GeminiProvider } from './geminiProvider.js';

/**
 * Phase 05-B3: provider factory (composition helper).
 *
 * - `none`   -> null (translateService keeps answering 501 NOT_IMPLEMENTED)
 * - `gemini` -> GeminiProvider built from the already validated configuration
 *
 * `fetchImpl` exists so tests can inject a mock; production passes nothing and
 * the provider uses Node's native fetch.
 *
 * @param {import('../../config/translationProvider.js').TranslationProviderConfig} providerConfig
 * @param {{ fetchImpl?: typeof fetch, logger?: { warn: (message: string, fields?: object) => void } | null }} [deps]
 * @returns {import('../../ports/translationProvider.js').TranslationProvider | null}
 * @throws {ConfigError} for an unknown provider id
 */
export function createProvider(providerConfig, { fetchImpl, logger = null } = {}) {
  switch (providerConfig?.provider) {
    case PROVIDER_NONE:
      return null;
    case PROVIDER_GEMINI: {
      const { apiKey, model, timeoutMs } = providerConfig.gemini;
      return new GeminiProvider({ apiKey, model, timeoutMs, fetchImpl, logger });
    }
    default:
      throw new ConfigError([`${PROVIDER_VAR} must be one of: ${PROVIDER_IDS.join(', ')}`]);
  }
}

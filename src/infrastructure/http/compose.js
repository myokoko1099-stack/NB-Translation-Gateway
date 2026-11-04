import { createHealthService } from '../../application/healthService.js';
import { createTranslateService } from '../../application/translateService.js';
import { createLogger } from '../logging/logger.js';
import { createServer } from './server.js';

/**
 * Composition root: wires config -> services -> HTTP server.
 * Phase 05-B1 injects NO translation provider.
 *
 * @param {ReturnType<typeof import('../../config/config.js').loadConfig>} config
 * @param {{ provider?: import('../../ports/translationProvider.js').TranslationProvider | null,
 *           logger?: ReturnType<typeof createLogger> }} [overrides]
 */
export function buildApp(config, overrides = {}) {
  const logger = overrides.logger ?? createLogger(config.logLevel);
  const services = {
    health: createHealthService(config),
    translate: createTranslateService({ provider: overrides.provider ?? null }),
  };
  return createServer({ config, services, logger });
}

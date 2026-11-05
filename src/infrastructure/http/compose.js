import { createHealthService } from '../../application/healthService.js';
import { createTranslateService } from '../../application/translateService.js';
import { AUTH_DISABLED, CLIENT_TOKEN_VAR } from '../../config/auth.js';
import { ConfigError } from '../../domain/errors.js';
import { createLogger } from '../logging/logger.js';
import { createAuthenticator } from './auth.js';
import { createRateLimiter } from './rateLimiter.js';
import { createServer } from './server.js';

/**
 * Composition root: wires config -> services -> HTTP server.
 * Phase 05-B1 injects NO translation provider.
 * Phase 05-B2.1 adds Bearer authentication (see config/auth.js).
 * Phase 05-B2.2 adds per-IP rate limiting (in-memory, single instance).
 * Phase 05-B3: the provider is created by src/index.js (createProvider) and
 * injected here; the default logger scrubs the client token's exact value.
 *
 * @param {ReturnType<typeof import('../../config/config.js').loadConfig>} config
 * @param {{ provider?: import('../../ports/translationProvider.js').TranslationProvider | null,
 *           logger?: ReturnType<typeof createLogger>,
 *           auth?: import('../../config/auth.js').AuthConfig,
 *           rateLimiter?: ReturnType<typeof createRateLimiter> }} [overrides]
 */
export function buildApp(config, overrides = {}) {
  const auth = overrides.auth ?? AUTH_DISABLED;
  const logger = overrides.logger ?? createLogger(config.logLevel, undefined, { secrets: [auth.token] });
  // Defence in depth: never serve production traffic without authentication.
  if (config.env === 'production' && !auth.enabled) {
    throw new ConfigError([`${CLIENT_TOKEN_VAR} is required`]);
  }
  const services = {
    health: createHealthService(config),
    translate: createTranslateService({ provider: overrides.provider ?? null }),
  };
  const rateLimiter =
    overrides.rateLimiter ?? createRateLimiter({ max: config.rateLimit.max, windowMs: config.rateLimit.windowMs });
  const server = createServer({ config, services, logger, authenticator: createAuthenticator(auth), rateLimiter });
  server.on('close', () => rateLimiter.stop());
  return server;
}

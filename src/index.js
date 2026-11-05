import { loadAuthConfig } from './config/auth.js';
import { loadConfig } from './config/config.js';
import { assertProductionConfig } from './config/productionGuard.js';
import { EnvSecretProvider } from './config/secrets.js';
import { loadTranslationProviderConfig } from './config/translationProvider.js';
import { ConfigError } from './domain/errors.js';
import { buildApp } from './infrastructure/http/compose.js';
import { createLogger } from './infrastructure/logging/logger.js';
import { createProvider } from './infrastructure/providers/createProvider.js';

let config;
let auth;
let providerConfig;
try {
  config = loadConfig(process.env);
  const secrets = new EnvSecretProvider(process.env);
  // Production without GATEWAY_CLIENT_TOKEN throws here -> exit 1 below.
  auth = loadAuthConfig(config, secrets);
  // Phase 05-B4: production-only guard (placeholder / weak client token,
  // LOG_LEVEL=debug). It throws a ConfigError that names variables only, which
  // exits 1 below - before the logger, the provider or the HTTP server exist.
  // It does nothing in development and test.
  assertProductionConfig(config, auth);
  // Phase 05-B3: TRANSLATION_PROVIDER=gemini without its API key (or with an
  // invalid provider setting) also stops startup. `none` (default) reads nothing.
  providerConfig = loadTranslationProviderConfig(process.env, secrets);
} catch (err) {
  if (err instanceof ConfigError) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
  throw err;
}

// Phase 05-B3: the exact values of the client token and the Gemini key are
// scrubbed from every log line (defence in depth; they are never logged on purpose).
const logger = createLogger(config.logLevel, undefined, { secrets: [auth.token, providerConfig.gemini?.apiKey] });
let server;
try {
  const provider = createProvider(providerConfig, { logger });
  server = buildApp(config, { logger, auth, provider });
} catch (err) {
  if (err instanceof ConfigError) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
  throw err;
}

if (!auth.enabled) {
  logger.warn('client authentication is NOT enforced (non-production only)', { env: config.env });
}

server.listen(config.server.port, config.server.host, () => {
  const addr = server.address();
  logger.info('server started', {
    service: config.service,
    version: config.version,
    env: config.env,
    host: config.server.host,
    port: typeof addr === 'object' && addr ? addr.port : config.server.port,
    authEnabled: auth.enabled,
    translationProvider: providerConfig.provider,
    translationModel: providerConfig.gemini?.model,
    rateLimitMax: config.rateLimit.max,
    rateLimitWindowMs: config.rateLimit.windowMs,
    trustedProxyHops: config.rateLimit.trustedProxyHops,
    corsAllowedOrigins: config.cors.allowedOrigins.length,
  });
});

function shutdown(signal) {
  logger.info('shutting down', { signal });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

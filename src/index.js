import { loadAuthConfig } from './config/auth.js';
import { loadConfig } from './config/config.js';
import { EnvSecretProvider } from './config/secrets.js';
import { ConfigError } from './domain/errors.js';
import { buildApp } from './infrastructure/http/compose.js';
import { createLogger } from './infrastructure/logging/logger.js';

let config;
let auth;
try {
  config = loadConfig(process.env);
  // Production without GATEWAY_CLIENT_TOKEN throws here -> exit 1 below.
  auth = loadAuthConfig(config, new EnvSecretProvider(process.env));
} catch (err) {
  if (err instanceof ConfigError) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
  throw err;
}

const logger = createLogger(config.logLevel);
let server;
try {
  server = buildApp(config, { logger, auth });
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
  });
});

function shutdown(signal) {
  logger.info('shutting down', { signal });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

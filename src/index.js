import { loadConfig } from './config/config.js';
import { ConfigError } from './domain/errors.js';
import { buildApp } from './infrastructure/http/compose.js';
import { createLogger } from './infrastructure/logging/logger.js';

let config;
try {
  config = loadConfig(process.env);
} catch (err) {
  if (err instanceof ConfigError) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
  throw err;
}

const logger = createLogger(config.logLevel);
const server = buildApp(config, { logger });

server.listen(config.server.port, config.server.host, () => {
  const addr = server.address();
  logger.info('server started', {
    service: config.service,
    version: config.version,
    env: config.env,
    host: config.server.host,
    port: typeof addr === 'object' && addr ? addr.port : config.server.port,
  });
});

function shutdown(signal) {
  logger.info('shutting down', { signal });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

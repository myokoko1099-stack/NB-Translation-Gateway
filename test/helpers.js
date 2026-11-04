import { loadConfig } from '../src/config/config.js';
import { buildApp } from '../src/infrastructure/http/compose.js';
import { createLogger } from '../src/infrastructure/logging/logger.js';

/** Start the real HTTP server on an ephemeral port. Returns { baseUrl, close, logs }. */
export async function startTestServer(envOverrides = {}, appOverrides = {}) {
  const config = loadConfig({ NODE_ENV: 'test', ...envOverrides });
  const logs = [];
  const logger = createLogger('debug', (line) => logs.push(line));
  const server = buildApp(config, { logger, ...appOverrides });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    logs,
    close: () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  };
}

export function postJson(baseUrl, path, body, headers = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

import { loadAuthConfig } from '../src/config/auth.js';
import { loadConfig } from '../src/config/config.js';
import { EnvSecretProvider } from '../src/config/secrets.js';
import { buildApp } from '../src/infrastructure/http/compose.js';
import { createLogger } from '../src/infrastructure/logging/logger.js';

/** Start the real HTTP server on an ephemeral port. Returns { baseUrl, close, logs }. */
export async function startTestServer(envOverrides = {}, appOverrides = {}) {
  const env = { NODE_ENV: 'test', ...envOverrides };
  const config = loadConfig(env);
  // Same path as production: the token (if any) comes from the environment map.
  const auth = loadAuthConfig(config, new EnvSecretProvider(env));
  const logs = [];
  const logger = createLogger('debug', (line) => logs.push(line));
  const server = buildApp(config, { logger, auth, ...appOverrides });
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

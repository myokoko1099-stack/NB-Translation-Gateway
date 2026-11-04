/**
 * Per-environment defaults. `port: null` means the variable is REQUIRED
 * (no default) so a misconfigured production deploy fails at startup.
 */
const COMMON = Object.freeze({
  maxBodyBytes: 1_048_576, // 1 MiB
  requestTimeoutMs: 30_000,
  maxTextChars: 20_000,
});

export const PROFILES = Object.freeze({
  development: Object.freeze({
    ...COMMON,
    host: '127.0.0.1',
    port: 8080,
    logLevel: 'debug',
  }),
  test: Object.freeze({
    ...COMMON,
    host: '127.0.0.1',
    port: 0, // ephemeral port
    logLevel: 'silent',
  }),
  production: Object.freeze({
    ...COMMON,
    host: '0.0.0.0',
    port: null, // required: hosting platform must provide PORT
    logLevel: 'info',
  }),
});

export const LOG_LEVELS = Object.freeze(['silent', 'error', 'warn', 'info', 'debug']);

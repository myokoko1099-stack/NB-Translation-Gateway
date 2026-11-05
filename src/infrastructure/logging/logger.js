import { createRedactor } from './redact.js';

const ORDER = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };

/**
 * Minimal JSON-lines logger. Callers should only pass non-sensitive fields:
 * never request bodies (novel text), headers or secrets.
 *
 * Phase 05-B2.4: as a safety net, every message and field is passed through
 * the redactor before it is written, so an API key, Bearer token,
 * Authorization/Cookie header or known secret value that slips into a log call
 * is replaced by [REDACTED]. Secret wrappers always serialise as [REDACTED].
 *
 * @param {keyof typeof ORDER} level
 * @param {(line: string) => void} [write]
 * @param {{ secrets?: Array<import('../../config/secrets.js').Secret | string | null | undefined> }} [options]
 *        `secrets`: exact values that must never appear in any log line.
 */
export function createLogger(level, write = (line) => process.stdout.write(`${line}\n`), options = {}) {
  const threshold = ORDER[level] ?? ORDER.info;
  const redactor = createRedactor({ secrets: options?.secrets ?? [] });
  const emit = (name, message, fields) => {
    if (ORDER[name] > threshold) return;
    const safeFields = fields === undefined || fields === null ? undefined : redactor.value(fields);
    write(
      JSON.stringify({
        time: new Date().toISOString(),
        level: name,
        message: typeof message === 'string' ? redactor.string(message) : message,
        ...(typeof safeFields === 'object' ? safeFields : undefined),
      }),
    );
  };
  return {
    error: (m, f) => emit('error', m, f),
    warn: (m, f) => emit('warn', m, f),
    info: (m, f) => emit('info', m, f),
    debug: (m, f) => emit('debug', m, f),
  };
}

const ORDER = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };

/**
 * Minimal JSON-lines logger. Callers must only pass non-sensitive fields:
 * never request bodies (novel text), headers or secrets.
 *
 * @param {keyof typeof ORDER} level
 * @param {(line: string) => void} [write]
 */
export function createLogger(level, write = (line) => process.stdout.write(`${line}\n`)) {
  const threshold = ORDER[level] ?? ORDER.info;
  const emit = (name, message, fields) => {
    if (ORDER[name] > threshold) return;
    write(JSON.stringify({ time: new Date().toISOString(), level: name, message, ...fields }));
  };
  return {
    error: (m, f) => emit('error', m, f),
    warn: (m, f) => emit('warn', m, f),
    info: (m, f) => emit('info', m, f),
    debug: (m, f) => emit('debug', m, f),
  };
}

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Secret } from '../src/config/secrets.js';
import { createLogger } from '../src/infrastructure/logging/logger.js';

describe('B2.4 logger redaction', () => {
  it('redacts known secret values, authorization fields and sensitive message text', () => {
    const lines = [];
    const secret = new Secret('custom-secret-value-12345');
    const logger = createLogger('debug', (line) => lines.push(line), { secrets: [secret] });
    logger.error(`provider failed with ${secret.reveal()}`, {
      authorization: `Bearer ${'bearer-secret-12345'}`,
      apiKey: 'another-secret-value',
      note: 'safe context',
    });
    const output = lines.join('\n');
    for (const value of ['custom-secret-value-12345', 'bearer-secret-12345', 'another-secret-value']) {
      assert.ok(!output.includes(value), `log leaked ${value}`);
    }
    assert.ok(output.includes('[REDACTED]'));
    assert.ok(output.includes('safe context'));
  });
  it('never serializes Error stack or cause properties', () => {
    const lines = [];
    const logger = createLogger('error', (line) => lines.push(line));
    const error = new Error('safe-ish message');
    error.stack = 'STACK-PRIVATE-MARKER';
    logger.error('failure', { error });
    assert.ok(!lines.join('').includes('STACK-PRIVATE-MARKER'));
  });
});

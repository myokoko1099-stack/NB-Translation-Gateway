import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Secret } from '../src/config/secrets.js';
import { createRedactor, describeError, redactString } from '../src/infrastructure/logging/redact.js';

describe('B2.4 secret redaction', () => {
  it('redacts sensitive object keys recursively', () => {
    const redactor = createRedactor();
    assert.deepEqual(redactor.value({ authorization: 'Bearer abcdefghi', nested: { apiKey: 'fake' }, safe: 'ok' }), {
      authorization: '[REDACTED]', nested: { apiKey: '[REDACTED]' }, safe: 'ok',
    });
  });
  it('redacts Bearer tokens and key query parameters in strings', () => {
    const sample = `Authorization: Bearer ${'token-value-123'} https://x.invalid/?key=${'api-secret-123'}`;
    const safe = redactString(sample);
    assert.ok(!safe.includes('token-value-123'));
    assert.ok(!safe.includes('api-secret-123'));
    assert.match(safe, /\[REDACTED\]/);
  });
  it('scrubs exact configured Secret values even when they have no known shape', () => {
    const secret = new Secret('private-random-value-987');
    const safe = createRedactor({ secrets: [secret] }).string(`provider said ${secret.reveal()}`);
    assert.equal(safe, 'provider said [REDACTED]');
  });
  it('does not include stack or cause when describing an Error', () => {
    const error = new Error('upstream failed');
    error.cause = new Error('nested cause');
    const described = describeError(error);
    assert.deepEqual(Object.keys(described).sort(), ['errorMessage', 'errorName']);
    assert.equal(described.errorMessage, 'upstream failed');
  });
});

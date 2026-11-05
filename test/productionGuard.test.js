import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Secret } from '../src/config/secrets.js';
import { assertProductionConfig, collectProductionProblems } from '../src/config/productionGuard.js';

describe('B2.4 production configuration guard', () => {
  const prod = { env: 'production', logLevel: 'info' };
  const auth = (value) => ({ enabled: true, token: new Secret(value) });
  it('allows production with a configured non-placeholder token and info logging', () => {
    assert.deepEqual(collectProductionProblems(prod, auth('some-real-looking-token-123456')), []);
    assert.doesNotThrow(() => assertProductionConfig(prod, auth('some-real-looking-token-123456')));
  });
  it('rejects missing authentication', () => {
    assert.throws(() => assertProductionConfig(prod, { enabled: false, token: null }), /GATEWAY_CLIENT_TOKEN/);
  });
  it('rejects obvious placeholder tokens without printing their value', () => {
    assert.throws(() => assertProductionConfig(prod, auth('<set-in-hosting-dashboard>')), /must not be a placeholder/);
  });
  it('rejects debug logging in production', () => {
    assert.deepEqual(collectProductionProblems({ ...prod, logLevel: 'debug' }, auth('valid-token-123456')), ['LOG_LEVEL must not be "debug" in production']);
  });
  it('does not alter development or test configuration', () => {
    for (const env of ['development', 'test']) {
      assert.deepEqual(collectProductionProblems({ env, logLevel: 'debug' }, { enabled: false, token: null }), []);
    }
  });
});

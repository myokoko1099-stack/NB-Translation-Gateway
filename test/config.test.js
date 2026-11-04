import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadConfig } from '../src/config/config.js';
import { Secret, EnvSecretProvider } from '../src/config/secrets.js';
import { ConfigError } from '../src/domain/errors.js';

describe('configuration', () => {
  it('uses development profile by default', () => {
    const c = loadConfig({});
    assert.equal(c.env, 'development');
    assert.equal(c.server.host, '127.0.0.1');
    assert.equal(c.server.port, 8080);
    assert.equal(c.logLevel, 'debug');
  });

  it('production profile binds 0.0.0.0 and logs at info when PORT is set', () => {
    const c = loadConfig({ NODE_ENV: 'production', PORT: '10000' });
    assert.equal(c.env, 'production');
    assert.equal(c.server.host, '0.0.0.0');
    assert.equal(c.server.port, 10000);
    assert.equal(c.logLevel, 'info');
  });

  it('env vars override profile defaults', () => {
    const c = loadConfig({ PORT: '9000', LOG_LEVEL: 'warn', MAX_TEXT_CHARS: '500', HOST: '0.0.0.0' });
    assert.equal(c.server.port, 9000);
    assert.equal(c.logLevel, 'warn');
    assert.equal(c.limits.maxTextChars, 500);
    assert.equal(c.server.host, '0.0.0.0');
  });

  it('config object is frozen', () => {
    const c = loadConfig({});
    assert.throws(() => {
      'use strict';
      c.env = 'x';
    }, TypeError);
  });

  it('config never contains secret-like keys', () => {
    const c = loadConfig({ GEMINI_API_KEY: 'should-not-appear' });
    assert.ok(!JSON.stringify(c).includes('should-not-appear'));
  });
});

describe('missing / invalid environment variables', () => {
  it('production without PORT fails with a clear message', () => {
    assert.throws(
      () => loadConfig({ NODE_ENV: 'production' }),
      (err) => err instanceof ConfigError && err.problems.includes('PORT is required'),
    );
  });

  it('unknown NODE_ENV fails', () => {
    assert.throws(() => loadConfig({ NODE_ENV: 'staging' }), ConfigError);
  });

  it('non-numeric PORT fails and does not echo the value', () => {
    try {
      loadConfig({ PORT: 'abc-secret-ish' });
      assert.fail('expected ConfigError');
    } catch (err) {
      assert.ok(err instanceof ConfigError);
      assert.ok(!err.message.includes('abc-secret-ish'));
    }
  });

  it('out-of-range values fail', () => {
    assert.throws(() => loadConfig({ PORT: '70000' }), ConfigError);
    assert.throws(() => loadConfig({ REQUEST_TIMEOUT_MS: '5' }), ConfigError);
  });

  it('invalid LOG_LEVEL fails', () => {
    assert.throws(() => loadConfig({ LOG_LEVEL: 'verbose' }), ConfigError);
  });

  it('reports all problems at once', () => {
    try {
      loadConfig({ NODE_ENV: 'production', LOG_LEVEL: 'bad' });
      assert.fail('expected ConfigError');
    } catch (err) {
      assert.equal(err.problems.length, 2);
    }
  });
});

describe('secret management interface', () => {
  it('Secret redacts in string, JSON and inspect output', async () => {
    const { inspect } = await import('node:util');
    const s = new Secret('super-secret-value');
    assert.equal(String(s), '[REDACTED]');
    assert.equal(JSON.stringify({ s }), '{"s":"[REDACTED]"}');
    assert.ok(!inspect(s).includes('super-secret-value'));
    assert.equal(s.reveal(), 'super-secret-value');
  });

  it('EnvSecretProvider.get returns undefined when missing or empty', () => {
    const p = new EnvSecretProvider({ EMPTY: '' });
    assert.equal(p.get('MISSING_KEY'), undefined);
    assert.equal(p.get('EMPTY'), undefined);
  });

  it('EnvSecretProvider.require throws ConfigError naming only the variable', () => {
    const p = new EnvSecretProvider({});
    assert.throws(() => p.require('GEMINI_API_KEY'), (e) => e instanceof ConfigError && e.message.includes('GEMINI_API_KEY'));
  });

  it('EnvSecretProvider rejects malformed secret names', () => {
    const p = new EnvSecretProvider({});
    assert.throws(() => p.get('lower-case'), ConfigError);
  });
});

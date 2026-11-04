import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { inspect } from 'node:util';
import { loadAuthConfig } from '../src/config/auth.js';
import { loadConfig } from '../src/config/config.js';
import { EnvSecretProvider } from '../src/config/secrets.js';
import { ConfigError } from '../src/domain/errors.js';
import { buildApp } from '../src/infrastructure/http/compose.js';
import { postJson, startTestServer } from './helpers.js';

const TOKEN = 'unit-test-client-token-value';
const WRONG = 'WRONG-SENTINEL-TOKEN-999';
const VALID = { sourceLanguage: 'ja', targetLanguage: 'my', text: 'こんにちは' };

/** Provider test double that counts calls. */
function countingProvider() {
  const p = {
    id: 'counting-double',
    calls: 0,
    async translate(r) {
      p.calls += 1;
      return { ...r, translatedText: 'ok', provider: 'counting-double' };
    },
  };
  return p;
}

const bearer = (t) => ({ authorization: `Bearer ${t}` });

describe('auth configuration (loadAuthConfig)', () => {
  const load = (env) => loadAuthConfig(loadConfig(env), new EnvSecretProvider(env));

  it('production without GATEWAY_CLIENT_TOKEN fails and names only the variable', () => {
    assert.throws(
      () => load({ NODE_ENV: 'production', PORT: '1' }),
      (e) => e instanceof ConfigError && e.problems.includes('GATEWAY_CLIENT_TOKEN is required'),
    );
  });

  it('production with an EMPTY token fails', () => {
    assert.throws(() => load({ NODE_ENV: 'production', PORT: '1', GATEWAY_CLIENT_TOKEN: '' }), ConfigError);
  });

  it('production with a whitespace-only token fails without echoing it', () => {
    try {
      load({ NODE_ENV: 'production', PORT: '1', GATEWAY_CLIENT_TOKEN: '   ' });
      assert.fail('expected ConfigError');
    } catch (e) {
      assert.ok(e instanceof ConfigError);
      assert.deepEqual(e.problems, ['GATEWAY_CLIENT_TOKEN must be non-empty printable ASCII without whitespace']);
    }
  });

  it('production with a valid token is enabled', () => {
    const a = load({ NODE_ENV: 'production', PORT: '1', GATEWAY_CLIENT_TOKEN: TOKEN });
    assert.equal(a.enabled, true);
  });

  it('development / test with no token: not enforced (B1 behaviour kept)', () => {
    assert.equal(load({}).enabled, false);
    assert.equal(load({ NODE_ENV: 'test' }).enabled, false);
    assert.equal(load({ NODE_ENV: 'test', GATEWAY_CLIENT_TOKEN: '' }).enabled, false);
  });

  it('development with a token enforces it', () => {
    assert.equal(load({ GATEWAY_CLIENT_TOKEN: TOKEN }).enabled, true);
  });

  it('a token containing whitespace is rejected in every environment, value not echoed', () => {
    const bad = 'has space-SECRETPART';
    for (const NODE_ENV of ['development', 'test', 'production']) {
      try {
        load({ NODE_ENV, PORT: '1', GATEWAY_CLIENT_TOKEN: bad });
        assert.fail('expected ConfigError');
      } catch (e) {
        assert.ok(e instanceof ConfigError);
        assert.ok(!e.message.includes('SECRETPART'));
      }
    }
  });

  it('the token never appears in JSON / inspect output of the auth config', () => {
    const a = load({ GATEWAY_CLIENT_TOKEN: TOKEN });
    assert.ok(!JSON.stringify(a).includes(TOKEN));
    assert.ok(!inspect(a).includes(TOKEN));
  });

  it('buildApp refuses production without enabled auth (defence in depth)', () => {
    const config = loadConfig({ NODE_ENV: 'production', PORT: '1' });
    assert.throws(() => buildApp(config), ConfigError);
  });
});

describe('POST /v1/translate - authentication enabled', () => {
  let srv;
  let provider;
  before(async () => {
    provider = countingProvider();
    srv = await startTestServer({ GATEWAY_CLIENT_TOKEN: TOKEN }, { provider });
  });
  after(() => srv.close());

  async function expect401(res) {
    assert.equal(res.status, 401);
    assert.equal(res.headers.get('www-authenticate'), 'Bearer');
    const text = await res.text();
    const body = JSON.parse(text);
    assert.equal(body.error.code, 'UNAUTHORIZED');
    assert.match(body.error.requestId, /^[0-9a-f-]{36}$/);
    assert.ok(!text.includes(TOKEN));
    assert.ok(!text.includes(WRONG));
    return text;
  }

  it('valid token -> authorized, provider called exactly once', async () => {
    const before = provider.calls;
    const res = await postJson(srv.baseUrl, '/v1/translate', VALID, bearer(TOKEN));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).translatedText, 'ok');
    assert.equal(provider.calls, before + 1);
  });

  it('scheme is case-insensitive (RFC 7235)', async () => {
    const res = await postJson(srv.baseUrl, '/v1/translate', VALID, { authorization: `bearer ${TOKEN}` });
    assert.equal(res.status, 200);
  });

  it('missing Authorization header -> 401, provider not called', async () => {
    const before = provider.calls;
    await expect401(await postJson(srv.baseUrl, '/v1/translate', VALID));
    assert.equal(provider.calls, before);
  });

  it('invalid token -> 401 (wrong, prefix, longer, case-changed), provider not called', async () => {
    const before = provider.calls;
    for (const t of [WRONG, TOKEN.slice(0, -1), `${TOKEN}x`, TOKEN.toUpperCase(), 'a']) {
      await expect401(await postJson(srv.baseUrl, '/v1/translate', VALID, bearer(t)));
    }
    assert.equal(provider.calls, before);
  });

  it('malformed Authorization header -> 401, provider not called', async () => {
    const before = provider.calls;
    const headers = [
      `Basic ${TOKEN}`,
      'Bearer',
      'Bearer ',
      `Bearer  ${TOKEN}`,
      `Bearer ${TOKEN} extra`,
      `Bearer${TOKEN}`,
      TOKEN,
      '',
      'Bearer a b',
    ];
    for (const authorization of headers) {
      await expect401(await postJson(srv.baseUrl, '/v1/translate', VALID, { authorization }));
    }
    assert.equal(provider.calls, before);
  });

  it('authentication runs before body parsing and validation', async () => {
    const before = provider.calls;
    await expect401(await postJson(srv.baseUrl, '/v1/translate', '{not json'));
    await expect401(await postJson(srv.baseUrl, '/v1/translate', {}));
    const res = await fetch(`${srv.baseUrl}/v1/translate`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'x',
    });
    await expect401(res);
    assert.equal(provider.calls, before);
  });

  it('authorized requests still get normal validation errors', async () => {
    const res = await postJson(srv.baseUrl, '/v1/translate', {}, bearer(TOKEN));
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error.code, 'INVALID_REQUEST');
  });

  it('authentication errors and logs do not expose the configured or submitted token', async () => {
    const texts = [];
    texts.push(await expect401(await postJson(srv.baseUrl, '/v1/translate', VALID, bearer(WRONG))));
    texts.push(await expect401(await postJson(srv.baseUrl, '/v1/translate', VALID)));
    const ok = await postJson(srv.baseUrl, '/v1/translate', VALID, bearer(TOKEN));
    texts.push(await ok.text());
    const all = [...texts, srv.logs.join('\n')].join('\n');
    assert.ok(!all.includes(TOKEN), 'configured token leaked');
    assert.ok(!all.includes(WRONG), 'submitted token leaked');
    assert.ok(srv.logs.some((l) => l.includes('authentication failed')), 'failure should be logged by reason');
  });

  it('GET /health is unchanged and needs no token', async () => {
    const res = await fetch(`${srv.baseUrl}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: 'ok', service: 'mnb-translation-gateway', version: '0.1.0' });
  });

  it('unknown routes still return 404', async () => {
    assert.equal((await fetch(`${srv.baseUrl}/nope`)).status, 404);
  });
});

describe('authentication enabled, no provider injected (B1 mode)', () => {
  let srv;
  before(async () => {
    srv = await startTestServer({ GATEWAY_CLIENT_TOKEN: TOKEN });
  });
  after(() => srv.close());

  it('valid token still yields 501 NOT_IMPLEMENTED (no fake success)', async () => {
    const res = await postJson(srv.baseUrl, '/v1/translate', VALID, bearer(TOKEN));
    assert.equal(res.status, 501);
    assert.equal((await res.json()).error.code, 'NOT_IMPLEMENTED');
  });

  it('missing token yields 401, not 501', async () => {
    assert.equal((await postJson(srv.baseUrl, '/v1/translate', VALID)).status, 401);
  });
});

describe('authentication not configured (test/dev)', () => {
  it('requests are not blocked and an unneeded header is ignored', async () => {
    const srv = await startTestServer();
    try {
      assert.equal((await postJson(srv.baseUrl, '/v1/translate', VALID)).status, 501);
      assert.equal((await postJson(srv.baseUrl, '/v1/translate', VALID, bearer('anything'))).status, 501);
    } finally {
      await srv.close();
    }
  });
});

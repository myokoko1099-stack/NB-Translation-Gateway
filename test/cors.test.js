import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CORS_ORIGINS_VAR, loadConfig } from '../src/config/config.js';
import { ConfigError } from '../src/domain/errors.js';
import {
  TOKEN,
  VALID,
  UUID,
  assertError,
  assertNoCorsGrant,
  assertSecurityHeaders,
  bearer,
  countingProvider,
  get,
  postJsonRaw,
  preflight,
  rawRequest,
  varyTokens,
  withServer,
} from './httpTestKit.js';
import { startTestServer } from './helpers.js';

const ALLOWED = 'https://app.example.com';
const ALLOWED_2 = 'http://localhost:3000';
const EVIL = 'https://evil.example.org';

const ENV = {
  GATEWAY_CLIENT_TOKEN: TOKEN,
  GATEWAY_RATE_LIMIT_MAX: '1000',
  [CORS_ORIGINS_VAR]: ` ${ALLOWED} , ${ALLOWED_2} `,
};

/* ------------------------------------------------------------------ */
describe('CORS - allowed origin', () => {
  it('GET /health from an allowed origin echoes THAT origin (never "*")', async () => {
    await withServer(ENV, {}, async (srv) => {
      for (const origin of [ALLOWED, ALLOWED_2]) {
        const res = await get(srv.baseUrl, '/health', { origin });
        assert.equal(res.status, 200);
        assert.equal(res.headers['access-control-allow-origin'], origin);
        assert.notEqual(res.headers['access-control-allow-origin'], '*');
        assert.ok(varyTokens(res).includes('origin'));
      }
    });
  });

  it('exposes the documented response headers and never enables credentials', async () => {
    await withServer(ENV, {}, async (srv) => {
      const res = await get(srv.baseUrl, '/health', { origin: ALLOWED });
      const exposed = String(res.headers['access-control-expose-headers'])
        .split(',')
        .map((s) => s.trim().toLowerCase());
      for (const name of ['x-request-id', 'retry-after', 'ratelimit-limit', 'ratelimit-remaining', 'ratelimit-reset']) {
        assert.ok(exposed.includes(name), `${name} should be exposed`);
      }
      assert.equal(res.headers['access-control-allow-credentials'], undefined);
    });
  });

  it('POST /v1/translate from an allowed origin works and carries the CORS header', async () => {
    const provider = countingProvider();
    await withServer(ENV, { provider }, async (srv) => {
      const res = await postJsonRaw(srv.baseUrl, VALID, { ...bearer(), origin: ALLOWED });
      assert.equal(res.status, 200);
      assert.equal(res.headers['access-control-allow-origin'], ALLOWED);
      assert.equal(res.json().translatedText, 'ok');
      assert.equal(provider.calls, 1);
    });
  });

  it('error responses (400 / 401 / 404) also carry the CORS header so the browser can read them', async () => {
    await withServer(ENV, {}, async (srv) => {
      const unauth = await postJsonRaw(srv.baseUrl, VALID, { origin: ALLOWED });
      assertError(unauth, 401, 'UNAUTHORIZED');
      assert.equal(unauth.headers['access-control-allow-origin'], ALLOWED);

      const invalid = await postJsonRaw(srv.baseUrl, {}, { ...bearer(), origin: ALLOWED });
      assertError(invalid, 400, 'INVALID_REQUEST');
      assert.equal(invalid.headers['access-control-allow-origin'], ALLOWED);

      const missing = await get(srv.baseUrl, '/nope', { origin: ALLOWED });
      assertError(missing, 404, 'NOT_FOUND');
      assert.equal(missing.headers['access-control-allow-origin'], ALLOWED);
    });
  });

  it('a rate-limited (429) response carries the CORS header and Retry-After', async () => {
    const provider = countingProvider();
    await withServer({ ...ENV, GATEWAY_RATE_LIMIT_MAX: '1' }, { provider }, async (srv) => {
      const headers = { ...bearer(), origin: ALLOWED };
      assert.equal((await postJsonRaw(srv.baseUrl, VALID, headers)).status, 200);
      const limited = await postJsonRaw(srv.baseUrl, VALID, headers);
      assertError(limited, 429, 'RATE_LIMITED');
      assert.equal(limited.headers['access-control-allow-origin'], ALLOWED);
      assert.match(limited.headers['retry-after'], /^[1-9]\d*$/);
      assert.equal(provider.calls, 1);
    });
  });
});

/* ------------------------------------------------------------------ */
describe('CORS - disallowed origin', () => {
  const DISALLOWED = [
    EVIL,
    'http://app.example.com', // scheme differs
    'https://app.example.com:8443', // port differs
    'https://APP.EXAMPLE.COM', // exact (case-sensitive) match only
    'https://app.example.com/', // trailing slash
    'https://sub.app.example.com',
    'https://app.example.com.evil.test',
    '*',
    '',
  ];

  it('every disallowed Origin value -> 403 ORIGIN_NOT_ALLOWED, no CORS grant, connection closed', async () => {
    const provider = countingProvider();
    await withServer(ENV, { provider }, async (srv) => {
      for (const origin of DISALLOWED) {
        const res = await get(srv.baseUrl, '/health', { origin });
        const label = JSON.stringify(origin);
        assertError(res, 403, 'ORIGIN_NOT_ALLOWED');
        assertNoCorsGrant(res, label);
        assert.equal(res.headers.connection, 'close', label);
      }
      assert.equal(provider.calls, 0);
    });
  });

  it('is decided BEFORE authentication, rate limiting, body parsing and the provider', async () => {
    const provider = countingProvider();
    await withServer({ ...ENV, GATEWAY_RATE_LIMIT_MAX: '1' }, { provider }, async (srv) => {
      // Valid token, valid body, bad origin -> still 403 and the provider is untouched.
      for (let i = 0; i < 3; i += 1) {
        const res = await postJsonRaw(srv.baseUrl, VALID, { ...bearer(), origin: EVIL });
        assertError(res, 403, 'ORIGIN_NOT_ALLOWED');
      }
      // No token + bad origin -> 403 (origin check runs first), not 401.
      assertError(await postJsonRaw(srv.baseUrl, VALID, { origin: EVIL }), 403, 'ORIGIN_NOT_ALLOWED');
      assert.equal(provider.calls, 0);
      // The rejected requests did not consume the rate-limit budget.
      assert.equal((await postJsonRaw(srv.baseUrl, VALID, bearer())).status, 200);
      assert.equal(provider.calls, 1);
    });
  });

  it('also applies to unknown routes (403, not 404)', async () => {
    await withServer(ENV, {}, async (srv) => {
      assertError(await get(srv.baseUrl, '/nope', { origin: EVIL }), 403, 'ORIGIN_NOT_ALLOWED');
    });
  });

  it('the rejected origin value is not logged; the rejection itself is', async () => {
    await withServer(ENV, {}, async (srv) => {
      const sentinel = 'https://sentinel-rejected-origin.test';
      assertError(await get(srv.baseUrl, '/health', { origin: sentinel }), 403, 'ORIGIN_NOT_ALLOWED');
      const logs = srv.logs.join('\n');
      assert.ok(logs.includes('origin rejected'));
      assert.ok(!logs.includes('sentinel-rejected-origin'));
    });
  });
});

/* ------------------------------------------------------------------ */
describe('CORS - request without an Origin header (native Android / curl)', () => {
  it('is allowed and receives no CORS headers', async () => {
    const provider = countingProvider();
    await withServer(ENV, { provider }, async (srv) => {
      const health = await get(srv.baseUrl, '/health');
      assert.equal(health.status, 200);
      assertNoCorsGrant(health);

      const translate = await postJsonRaw(srv.baseUrl, VALID, bearer());
      assert.equal(translate.status, 200);
      assertNoCorsGrant(translate);
      assert.equal(provider.calls, 1);
    });
  });

  it('works the same when the allowlist is configured and when it is empty', async () => {
    for (const env of [ENV, { GATEWAY_CLIENT_TOKEN: TOKEN }]) {
      await withServer(env, { provider: countingProvider() }, async (srv) => {
        assert.equal((await postJsonRaw(srv.baseUrl, VALID, bearer())).status, 200);
      });
    }
  });
});

/* ------------------------------------------------------------------ */
describe('CORS - literal "null" origin', () => {
  it('is rejected with 403 even when other origins are allowed', async () => {
    await withServer(ENV, {}, async (srv) => {
      const res = await get(srv.baseUrl, '/health', { origin: 'null' });
      assertError(res, 403, 'ORIGIN_NOT_ALLOWED');
      assertNoCorsGrant(res);
    });
  });

  it('is rejected for POST and for a preflight too', async () => {
    const provider = countingProvider();
    await withServer(ENV, { provider }, async (srv) => {
      assertError(await postJsonRaw(srv.baseUrl, VALID, { ...bearer(), origin: 'null' }), 403, 'ORIGIN_NOT_ALLOWED');
      assertError(await preflight(srv.baseUrl, { origin: 'null' }), 403, 'ORIGIN_NOT_ALLOWED');
      assert.equal(provider.calls, 0);
    });
  });
});

/* ------------------------------------------------------------------ */
describe('CORS - empty allowlist', () => {
  for (const [label, value] of [
    ['variable unset', undefined],
    ['empty string', ''],
    ['whitespace only', '   '],
    ['only separators', ' , ,'],
  ]) {
    it(`${label}: config has no origins, every browser origin is rejected, native clients still work`, async () => {
      const env = { GATEWAY_CLIENT_TOKEN: TOKEN };
      if (value !== undefined) env[CORS_ORIGINS_VAR] = value;
      assert.deepEqual([...loadConfig(env).cors.allowedOrigins], []);

      const provider = countingProvider();
      await withServer(env, { provider }, async (srv) => {
        for (const origin of [ALLOWED, ALLOWED_2, 'null', EVIL]) {
          assertError(await get(srv.baseUrl, '/health', { origin }), 403, 'ORIGIN_NOT_ALLOWED');
        }
        assertError(await preflight(srv.baseUrl, { origin: ALLOWED }), 403, 'ORIGIN_NOT_ALLOWED');
        assert.equal((await postJsonRaw(srv.baseUrl, VALID, bearer())).status, 200);
        assert.equal(provider.calls, 1);
      });
    });
  }
});

/* ------------------------------------------------------------------ */
describe('CORS - configuration validation (wildcards and malformed entries are rejected)', () => {
  const load = (value) => loadConfig({ [CORS_ORIGINS_VAR]: value });

  it('a wildcard entry fails startup configuration and is never turned into "allow all"', async () => {
    for (const value of ['*', 'https://*.example.com', '*.example.com', `${ALLOWED},*`]) {
      assert.throws(
        () => load(value),
        (e) => e instanceof ConfigError && e.problems.some((p) => p.startsWith(CORS_ORIGINS_VAR)),
        value,
      );
    }
    await assert.rejects(startTestServer({ [CORS_ORIGINS_VAR]: '*' }), ConfigError);
  });

  it('other non-canonical entries are rejected too', () => {
    const bad = [
      'null',
      'app.example.com',
      'ftp://app.example.com',
      'chrome-extension://abcdefghijklmnop',
      'https://app.example.com/',
      'https://app.example.com/path',
      'https://app.example.com?x=1',
      'https://app.example.com#frag',
      'https://user:pw@app.example.com',
      'HTTPS://APP.EXAMPLE.COM',
      'https://app.example.com:443', // default port must be omitted
      'http://app.example.com:80',
      `https://${'a'.repeat(250)}.com`, // longer than 255 characters
    ];
    for (const value of bad) {
      assert.throws(() => load(value), ConfigError, value);
    }
  });

  it('one bad entry rejects the whole list (no partial acceptance) and names only its position', () => {
    try {
      load(`${ALLOWED}, https://sentinel-leak-check.test/path`);
      assert.fail('expected ConfigError');
    } catch (e) {
      assert.ok(e instanceof ConfigError);
      assert.equal(e.problems.length, 1);
      assert.ok(e.problems[0].startsWith(`${CORS_ORIGINS_VAR} entry 2`));
      assert.ok(!e.problems.join('\n').includes('sentinel-leak-check'), 'entry value must not be echoed');
      assert.ok(!e.message.includes('sentinel-leak-check'));
    }
  });

  it('valid lists are trimmed and de-duplicated; scheme, host and non-default port are kept', () => {
    const c = load(` ${ALLOWED} ,${ALLOWED_2},${ALLOWED}, https://app.example.com:8443 `);
    assert.deepEqual([...c.cors.allowedOrigins], [ALLOWED, ALLOWED_2, 'https://app.example.com:8443']);
    assert.ok(Object.isFrozen(c.cors));
    assert.ok(Object.isFrozen(c.cors.allowedOrigins));
  });

  it('at most 50 origins are accepted', () => {
    const make = (n) => Array.from({ length: n }, (_, i) => `https://o${i}.example.com`).join(',');
    assert.equal(load(make(50)).cors.allowedOrigins.length, 50);
    assert.throws(() => load(make(51)), (e) => e instanceof ConfigError && e.problems[0].startsWith(CORS_ORIGINS_VAR));
  });
});

/* ------------------------------------------------------------------ */
describe('CORS - OPTIONS preflight', () => {
  it('valid preflight -> 204, empty body, full set of CORS headers', async () => {
    await withServer(ENV, {}, async (srv) => {
      const res = await preflight(srv.baseUrl, { origin: ALLOWED });
      assert.equal(res.status, 204);
      assert.equal(res.text, '');
      assert.equal(res.headers['access-control-allow-origin'], ALLOWED);
      assert.equal(res.headers['access-control-allow-methods'], 'POST');
      assert.equal(res.headers['access-control-allow-headers'], 'authorization, content-type');
      assert.equal(res.headers['access-control-max-age'], '600');
      assert.equal(res.headers['access-control-allow-credentials'], undefined);
      assert.match(res.headers['x-request-id'], UUID);
    });
  });

  it('allowed methods are those of the matched route (GET for /health)', async () => {
    await withServer(ENV, {}, async (srv) => {
      const res = await preflight(srv.baseUrl, { path: '/health', origin: ALLOWED, method: 'GET', requestHeaders: null });
      assert.equal(res.status, 204);
      assert.equal(res.headers['access-control-allow-methods'], 'GET');
    });
  });

  it('request-header names are matched case-insensitively', async () => {
    await withServer(ENV, {}, async (srv) => {
      const res = await preflight(srv.baseUrl, { origin: ALLOWED_2, requestHeaders: 'Authorization,  CONTENT-TYPE' });
      assert.equal(res.status, 204);
      assert.equal(res.headers['access-control-allow-origin'], ALLOWED_2);
    });
  });

  it('a preflight without Access-Control-Request-Headers is accepted', async () => {
    await withServer(ENV, {}, async (srv) => {
      assert.equal((await preflight(srv.baseUrl, { origin: ALLOWED, requestHeaders: null })).status, 204);
    });
  });

  it('needs no Authorization and does not consume the rate-limit budget or call the provider', async () => {
    const provider = countingProvider();
    await withServer({ ...ENV, GATEWAY_RATE_LIMIT_MAX: '1' }, { provider }, async (srv) => {
      for (let i = 0; i < 5; i += 1) {
        assert.equal((await preflight(srv.baseUrl, { origin: ALLOWED })).status, 204);
      }
      assert.equal(provider.calls, 0);
      assert.equal((await postJsonRaw(srv.baseUrl, VALID, bearer())).status, 200, 'budget untouched by preflights');
      assert.equal((await postJsonRaw(srv.baseUrl, VALID, bearer())).status, 429);
      assert.equal(provider.calls, 1);
    });
  });

  it('a preflight from a disallowed origin -> 403 ORIGIN_NOT_ALLOWED with no CORS grant', async () => {
    await withServer(ENV, {}, async (srv) => {
      const res = await preflight(srv.baseUrl, { origin: EVIL });
      assertError(res, 403, 'ORIGIN_NOT_ALLOWED');
      assertNoCorsGrant(res);
    });
  });

  it('a preflight for an unknown route -> 404 (route lookup precedes the preflight)', async () => {
    await withServer(ENV, {}, async (srv) => {
      assertError(await preflight(srv.baseUrl, { path: '/nope', origin: ALLOWED }), 404, 'NOT_FOUND');
    });
  });

  it('OPTIONS without Access-Control-Request-Method is not a preflight -> 405 (with or without Origin)', async () => {
    await withServer(ENV, {}, async (srv) => {
      for (const origin of [ALLOWED, null]) {
        const res = await preflight(srv.baseUrl, { origin, method: null, requestHeaders: null });
        assertError(res, 405, 'METHOD_NOT_ALLOWED');
        assert.equal(res.headers.allow, 'POST');
      }
    });
  });

  it('OPTIONS + Access-Control-Request-Method but NO Origin is not treated as a preflight -> 405', async () => {
    await withServer(ENV, {}, async (srv) => {
      const res = await preflight(srv.baseUrl, { origin: null });
      assertError(res, 405, 'METHOD_NOT_ALLOWED');
      assertNoCorsGrant(res);
    });
  });
});

/* ------------------------------------------------------------------ */
describe('CORS - invalid preflight method', () => {
  it('a method the route does not support -> 403 CORS_PREFLIGHT_REJECTED, no allow-methods grant', async () => {
    const provider = countingProvider();
    await withServer(ENV, { provider }, async (srv) => {
      for (const method of ['GET', 'PUT', 'DELETE', 'PATCH', 'post', 'TRACE', 'FOO']) {
        const res = await preflight(srv.baseUrl, { origin: ALLOWED, method });
        assertError(res, 403, 'CORS_PREFLIGHT_REJECTED');
        for (const name of ['access-control-allow-methods', 'access-control-allow-headers', 'access-control-max-age']) {
          assert.equal(res.headers[name], undefined, `${name} must be absent for ${method}`);
        }
      }
      assert.equal(provider.calls, 0);
    });
  });

  it('is per route: POST is refused for /health, GET is refused for /v1/translate', async () => {
    await withServer(ENV, {}, async (srv) => {
      assertError(await preflight(srv.baseUrl, { path: '/health', origin: ALLOWED, method: 'POST' }), 403, 'CORS_PREFLIGHT_REJECTED');
      assertError(await preflight(srv.baseUrl, { origin: ALLOWED, method: 'GET' }), 403, 'CORS_PREFLIGHT_REJECTED');
    });
  });

  it('the rejection is logged without the origin value', async () => {
    await withServer(ENV, {}, async (srv) => {
      await preflight(srv.baseUrl, { origin: ALLOWED, method: 'DELETE' });
      const logs = srv.logs.join('\n');
      assert.ok(logs.includes('cors preflight rejected'));
      assert.ok(!logs.includes(ALLOWED));
    });
  });
});

/* ------------------------------------------------------------------ */
describe('CORS - invalid preflight headers', () => {
  it('any requested header outside {authorization, content-type} -> 403 CORS_PREFLIGHT_REJECTED', async () => {
    const provider = countingProvider();
    await withServer(ENV, { provider }, async (srv) => {
      for (const requestHeaders of [
        'x-custom',
        'x-api-key',
        'authorization, x-evil', // one bad name poisons the list
        'content-type,cookie',
        'content-type, authorization, x-forwarded-for',
        'Authorization, X-EVIL',
      ]) {
        const res = await preflight(srv.baseUrl, { origin: ALLOWED, requestHeaders });
        assertError(res, 403, 'CORS_PREFLIGHT_REJECTED');
        assert.equal(res.headers['access-control-allow-headers'], undefined, requestHeaders);
        assert.equal(res.headers['access-control-max-age'], undefined, requestHeaders);
      }
      assert.equal(provider.calls, 0);
    });
  });
});

/* ------------------------------------------------------------------ */
describe('CORS - Vary: Origin', () => {
  it('is present on success, error, 404, 403, 405, 204 and native (no Origin) responses', async () => {
    await withServer({ ...ENV, GATEWAY_RATE_LIMIT_MAX: '1' }, { provider: countingProvider() }, async (srv) => {
      const cases = {
        'native 200': await get(srv.baseUrl, '/health'),
        'allowed 200': await get(srv.baseUrl, '/health', { origin: ALLOWED }),
        'denied 403': await get(srv.baseUrl, '/health', { origin: EVIL }),
        'null-origin 403': await get(srv.baseUrl, '/health', { origin: 'null' }),
        'native 404': await get(srv.baseUrl, '/nope'),
        'allowed 404': await get(srv.baseUrl, '/nope', { origin: ALLOWED }),
        '405': await rawRequest(srv.baseUrl, { method: 'GET', path: '/v1/translate' }),
        '401': await postJsonRaw(srv.baseUrl, VALID),
        '204 preflight': await preflight(srv.baseUrl, { origin: ALLOWED }),
        '403 preflight rejected': await preflight(srv.baseUrl, { origin: ALLOWED, method: 'DELETE' }),
      };
      assert.equal((await postJsonRaw(srv.baseUrl, VALID, bearer())).status, 200);
      cases['429'] = await postJsonRaw(srv.baseUrl, VALID, bearer());

      for (const [label, res] of Object.entries(cases)) {
        assert.ok(varyTokens(res).includes('origin'), `Vary must include Origin: ${label} (got "${res.headers.vary}")`);
      }
      assert.equal(cases['429'].status, 429);
      assert.equal(cases['204 preflight'].status, 204);
    });
  });

  it('the preflight 204 also varies on the request-method and request-headers', async () => {
    await withServer(ENV, {}, async (srv) => {
      const res = await preflight(srv.baseUrl, { origin: ALLOWED });
      const tokens = varyTokens(res);
      for (const t of ['origin', 'access-control-request-method', 'access-control-request-headers']) {
        assert.ok(tokens.includes(t), `Vary should include ${t}`);
      }
    });
  });

  it('is present even when the allowlist is empty', async () => {
    await withServer({ GATEWAY_CLIENT_TOKEN: TOKEN }, {}, async (srv) => {
      assert.ok(varyTokens(await get(srv.baseUrl, '/health')).includes('origin'));
      assert.ok(varyTokens(await get(srv.baseUrl, '/health', { origin: EVIL })).includes('origin'));
    });
  });
});

/* ------------------------------------------------------------------ */
describe('CORS - security headers still accompany every CORS outcome', () => {
  it('allowed, denied, preflight 204 and preflight 403 all carry the security headers', async () => {
    await withServer(ENV, {}, async (srv) => {
      assertSecurityHeaders(await get(srv.baseUrl, '/health', { origin: ALLOWED }), 'allowed');
      assertSecurityHeaders(await get(srv.baseUrl, '/health', { origin: EVIL }), 'denied');
      assertSecurityHeaders(await preflight(srv.baseUrl, { origin: ALLOWED }), 'preflight 204');
      assertSecurityHeaders(await preflight(srv.baseUrl, { origin: ALLOWED, method: 'PUT' }), 'preflight 403');
    });
  });
});

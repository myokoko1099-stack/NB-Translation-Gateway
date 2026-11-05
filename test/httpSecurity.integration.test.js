import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRateLimiter } from '../src/infrastructure/http/rateLimiter.js';
import {
  TOKEN,
  VALID,
  UUID,
  assertError,
  assertSecurityHeaders,
  bearer,
  countingProvider,
  get,
  post,
  postJsonRaw,
  preflight,
  rawRequest,
  withServer,
} from './httpTestKit.js';

const ALLOWED = 'https://app.example.com';
const EVIL = 'https://evil.example.org';
const MAX = 1024;

const ENV = {
  GATEWAY_CLIENT_TOKEN: TOKEN,
  GATEWAY_RATE_LIMIT_MAX: '1000',
  GATEWAY_CORS_ALLOWED_ORIGINS: ALLOWED,
  MAX_BODY_BYTES: String(MAX),
  REQUEST_TIMEOUT_MS: '1000',
};

/* ------------------------------------------------------------------ */
describe('regression - authentication still works with B2.3 enabled', () => {
  it('valid token -> 200; provider called exactly once', async () => {
    const provider = countingProvider();
    await withServer(ENV, { provider }, async (srv) => {
      const res = await postJsonRaw(srv.baseUrl, VALID, bearer());
      assert.equal(res.status, 200);
      assert.equal(res.json().translatedText, 'ok');
      assert.equal(provider.calls, 1);
    });
  });

  it('missing / wrong / malformed token -> 401 with WWW-Authenticate; provider never called', async () => {
    const provider = countingProvider();
    await withServer(ENV, { provider }, async (srv) => {
      for (const headers of [
        {},
        bearer('wrong-token-value'),
        { authorization: `Basic ${TOKEN}` },
        { authorization: 'Bearer' },
        { authorization: `Bearer ${TOKEN} extra` },
      ]) {
        const res = await postJsonRaw(srv.baseUrl, VALID, headers);
        const body = assertError(res, 401, 'UNAUTHORIZED');
        assert.equal(res.headers['www-authenticate'], 'Bearer');
        assert.ok(!res.text.includes(TOKEN));
        assert.match(body.error.requestId, UUID);
        assertSecurityHeaders(res, '401');
      }
      assert.equal(provider.calls, 0);
    });
  });

  it('401 also works for a request from an allowed browser origin', async () => {
    await withServer(ENV, {}, async (srv) => {
      const res = await postJsonRaw(srv.baseUrl, VALID, { origin: ALLOWED });
      assertError(res, 401, 'UNAUTHORIZED');
      assert.equal(res.headers['access-control-allow-origin'], ALLOWED);
    });
  });
});

/* ------------------------------------------------------------------ */
describe('regression - rate limiting still works with B2.3 enabled', () => {
  it('N requests succeed with RateLimit-* headers, the next one is 429 with Retry-After', async () => {
    const provider = countingProvider();
    await withServer({ ...ENV, GATEWAY_RATE_LIMIT_MAX: '3' }, { provider }, async (srv) => {
      for (const remaining of ['2', '1', '0']) {
        const res = await postJsonRaw(srv.baseUrl, VALID, bearer());
        assert.equal(res.status, 200);
        assert.equal(res.headers['ratelimit-limit'], '3');
        assert.equal(res.headers['ratelimit-remaining'], remaining);
        assertSecurityHeaders(res, `200 remaining ${remaining}`);
      }
      const limited = await postJsonRaw(srv.baseUrl, VALID, bearer());
      assertError(limited, 429, 'RATE_LIMITED');
      assert.match(limited.headers['retry-after'], /^[1-9]\d*$/);
      assert.equal(limited.headers['ratelimit-remaining'], '0');
      assertSecurityHeaders(limited, '429');
      assert.equal(provider.calls, 3, 'provider is not called for the limited request');
    });
  });

  it('only authenticated requests create limiter records (unauthenticated floods and bad origins do not)', async () => {
    const rateLimiter = createRateLimiter({ max: 5, windowMs: 60_000 });
    await withServer(ENV, { rateLimiter }, async (srv) => {
      for (let i = 0; i < 10; i += 1) {
        await postJsonRaw(srv.baseUrl, VALID); // 401
        await postJsonRaw(srv.baseUrl, VALID, bearer('wrong-token-value')); // 401
        await postJsonRaw(srv.baseUrl, VALID, { ...bearer(), origin: EVIL }); // 403
        await preflight(srv.baseUrl, { origin: ALLOWED }); // 204
      }
      assert.equal(rateLimiter.size(), 0);
      await postJsonRaw(srv.baseUrl, VALID, bearer());
      assert.equal(rateLimiter.size(), 1);
    });
  });
});

/* ------------------------------------------------------------------ */
describe('regression - pipeline order: Origin -> Auth -> Rate limit -> Body', () => {
  const BAD_BODIES = {
    'wrong Content-Type (415)': (extra) =>
      post(extra.baseUrl, { headers: { ...extra.headers, 'content-type': 'text/plain', 'content-length': '1' }, body: 'x' }),
    'oversized body (413)': (extra) => postJsonRaw(extra.baseUrl, 'x'.repeat(MAX + 1), extra.headers),
    'invalid JSON (400)': (extra) => postJsonRaw(extra.baseUrl, '{not json', extra.headers),
    'empty body (400)': (extra) => postJsonRaw(extra.baseUrl, '', extra.headers),
  };

  it('Auth before Body: with no token, bad bodies are answered 401, not 415 / 413 / 400', async () => {
    const provider = countingProvider();
    await withServer(ENV, { provider }, async (srv) => {
      for (const [label, send] of Object.entries(BAD_BODIES)) {
        const res = await send({ baseUrl: srv.baseUrl, headers: {} });
        assertError(res, 401, 'UNAUTHORIZED');
        assert.ok(res.status === 401, label);
      }
      assert.equal(provider.calls, 0);
    });
  });

  it('Auth before Body: an unfinished body without a token is answered 401 at once (no 408 wait)', async () => {
    await withServer(ENV, {}, async (srv) => {
      const startedAt = Date.now();
      const res = await post(srv.baseUrl, {
        headers: { 'content-type': 'application/json', 'content-length': '200' },
        hold: '{"a":',
      });
      assertError(res, 401, 'UNAUTHORIZED');
      assert.ok(Date.now() - startedAt < 900, 'must not wait for the body');
    });
  });

  it('Rate limit before Body: once limited, bad bodies are answered 429, not 415 / 413 / 400', async () => {
    const provider = countingProvider();
    await withServer({ ...ENV, GATEWAY_RATE_LIMIT_MAX: '1' }, { provider }, async (srv) => {
      assert.equal((await postJsonRaw(srv.baseUrl, VALID, bearer())).status, 200);
      for (const send of Object.values(BAD_BODIES)) {
        assertError(await send({ baseUrl: srv.baseUrl, headers: bearer() }), 429, 'RATE_LIMITED');
      }
      const unfinished = await post(srv.baseUrl, {
        headers: { ...bearer(), 'content-type': 'application/json', 'content-length': '200' },
        hold: '{"a":',
      });
      assertError(unfinished, 429, 'RATE_LIMITED');
      assert.equal(provider.calls, 1);
    });
  });

  it('Auth before Rate limit: a wrong token is still 401 (not 429) once the budget is used up', async () => {
    await withServer({ ...ENV, GATEWAY_RATE_LIMIT_MAX: '1' }, { provider: countingProvider() }, async (srv) => {
      assert.equal((await postJsonRaw(srv.baseUrl, VALID, bearer())).status, 200);
      assert.equal((await postJsonRaw(srv.baseUrl, VALID, bearer())).status, 429);
      assertError(await postJsonRaw(srv.baseUrl, VALID, bearer('wrong-token-value')), 401, 'UNAUTHORIZED');
    });
  });

  it('Origin before Auth: a disallowed origin is 403 even with a valid token or no token', async () => {
    const provider = countingProvider();
    await withServer(ENV, { provider }, async (srv) => {
      assertError(await postJsonRaw(srv.baseUrl, VALID, { ...bearer(), origin: EVIL }), 403, 'ORIGIN_NOT_ALLOWED');
      assertError(await postJsonRaw(srv.baseUrl, VALID, { origin: EVIL }), 403, 'ORIGIN_NOT_ALLOWED');
      assert.equal(provider.calls, 0);
    });
  });

  it('Body checks apply after Auth + Rate limit when both pass (full pipeline reaches the handler)', async () => {
    const provider = countingProvider();
    await withServer({ ...ENV, GATEWAY_RATE_LIMIT_MAX: '10' }, { provider }, async (srv) => {
      assertError(await BAD_BODIES['wrong Content-Type (415)']({ baseUrl: srv.baseUrl, headers: bearer() }), 415, 'UNSUPPORTED_MEDIA_TYPE');
      assertError(await BAD_BODIES['oversized body (413)']({ baseUrl: srv.baseUrl, headers: bearer() }), 413, 'PAYLOAD_TOO_LARGE');
      assertError(await BAD_BODIES['invalid JSON (400)']({ baseUrl: srv.baseUrl, headers: bearer() }), 400, 'INVALID_JSON');
      assertError(await BAD_BODIES['empty body (400)']({ baseUrl: srv.baseUrl, headers: bearer() }), 400, 'INVALID_JSON');
      assert.equal(provider.calls, 0);
    });
  });
});

/* ------------------------------------------------------------------ */
describe('regression - the translation provider is never called for a rejected request', () => {
  it('403, 401, 404, 405, 415, 413, 408, 400, 204 and 429 leave the provider untouched', async () => {
    const provider = countingProvider();
    // Rejections that happen AFTER authentication (415 / 413 / 408 / 400) do use up
    // rate-limit budget, so the limit is set well above the number of requests here.
    await withServer({ ...ENV, GATEWAY_RATE_LIMIT_MAX: '1000' }, { provider }, async (srv) => {
      const url = srv.baseUrl;
      const typed = (type) => post(url, { headers: { ...bearer(), 'content-type': type, 'content-length': '2' }, body: '{}' });

      const rejected = [
        [403, await postJsonRaw(url, VALID, { ...bearer(), origin: EVIL })],
        [403, await postJsonRaw(url, VALID, { ...bearer(), origin: 'null' })],
        [401, await postJsonRaw(url, VALID)],
        [401, await postJsonRaw(url, VALID, bearer('wrong-token-value'))],
        [404, await get(url, '/nope')],
        [405, await rawRequest(url, { method: 'GET', path: '/v1/translate' })],
        [415, await post(url, { headers: bearer(), body: JSON.stringify(VALID) })],
        [415, await typed('text/plain')],
        [415, await typed('application/json; charset=utf-16')],
        [413, await postJsonRaw(url, 'x'.repeat(MAX + 1), bearer())],
        [
          413,
          await post(url, {
            headers: { ...bearer(), 'content-type': 'application/json', 'transfer-encoding': 'chunked' },
            chunks: ['a'.repeat(700), 'b'.repeat(700)],
          }),
        ],
        [
          408,
          await post(url, {
            headers: { ...bearer(), 'content-type': 'application/json', 'content-length': '200' },
            hold: '{"a":',
          }),
        ],
        [400, await postJsonRaw(url, '{not json', bearer())],
        [400, await postJsonRaw(url, '', bearer())],
        [400, await postJsonRaw(url, {}, bearer())],
        [204, await preflight(url, { origin: ALLOWED })],
        [403, await preflight(url, { origin: ALLOWED, method: 'DELETE' })],
        [403, await preflight(url, { origin: ALLOWED, requestHeaders: 'x-evil' })],
      ];
      for (const [expected, res] of rejected) {
        assert.equal(res.status, expected, `expected ${expected}, got ${res.status}: ${res.text.slice(0, 120)}`);
      }
      assert.equal(provider.calls, 0, 'provider must not be called by any rejected request');

      // Sanity check: the same server still serves a valid request afterwards.
      assert.equal((await postJsonRaw(url, VALID, bearer())).status, 200);
      assert.equal(provider.calls, 1);
    });
  });

  it('with no provider injected, authorised valid requests are still 501 (no fake success)', async () => {
    await withServer(ENV, {}, async (srv) => {
      assertError(await postJsonRaw(srv.baseUrl, VALID, bearer()), 501, 'NOT_IMPLEMENTED');
    });
  });
});

/* ------------------------------------------------------------------ */
describe('regression - GET /health keeps working', () => {
  it('is public, returns the same body, and is not rate limited', async () => {
    await withServer({ ...ENV, GATEWAY_RATE_LIMIT_MAX: '1' }, {}, async (srv) => {
      let first;
      for (let i = 0; i < 10; i += 1) {
        const res = await get(srv.baseUrl, '/health');
        assert.equal(res.status, 200);
        assert.equal(res.headers['ratelimit-limit'], undefined);
        assertSecurityHeaders(res, 'health');
        first ??= res.json();
        assert.deepEqual(res.json(), first);
      }
      assert.equal(first.status, 'ok');
      assert.equal(typeof first.service, 'string');
      assert.equal(typeof first.version, 'string');
    });
  });

  it('works for native clients, allowed browser origins, and with an empty allowlist (native)', async () => {
    await withServer(ENV, {}, async (srv) => {
      assert.equal((await get(srv.baseUrl, '/health')).status, 200);
      const browser = await get(srv.baseUrl, '/health', { origin: ALLOWED });
      assert.equal(browser.status, 200);
      assert.equal(browser.headers['access-control-allow-origin'], ALLOWED);
    });
    await withServer({}, {}, async (srv) => {
      assert.equal((await get(srv.baseUrl, '/health')).status, 200);
    });
  });

  it('does not leak the token, and non-GET methods are still refused', async () => {
    await withServer(ENV, {}, async (srv) => {
      const res = await get(srv.baseUrl, '/health');
      assert.ok(!res.text.includes(TOKEN));
      const wrongMethod = await rawRequest(srv.baseUrl, { method: 'POST', path: '/health', headers: { 'content-length': '0' } });
      assertError(wrongMethod, 405, 'METHOD_NOT_ALLOWED');
    });
  });
});

/* ------------------------------------------------------------------ */
describe('regression - secrets never reach responses or logs', () => {
  it('the client token appears in no response body, response header or log line across all the rejection paths', async () => {
    await withServer({ ...ENV, GATEWAY_RATE_LIMIT_MAX: '1' }, { provider: countingProvider() }, async (srv) => {
      const url = srv.baseUrl;
      const responses = [
        await postJsonRaw(url, VALID, bearer()),
        await postJsonRaw(url, VALID, bearer()), // 429
        await postJsonRaw(url, VALID, { ...bearer(), origin: EVIL }), // 403
        await postJsonRaw(url, VALID), // 401
        await postJsonRaw(url, '{bad', { ...bearer(), origin: ALLOWED }),
        await preflight(url, { origin: ALLOWED }),
        await get(url, '/health'),
      ];
      const everything = [
        ...responses.map((r) => r.text + r.rawHeaders.join('\n')),
        srv.logs.join('\n'),
      ].join('\n');
      assert.ok(!everything.includes(TOKEN), 'client token leaked');
    });
  });
});

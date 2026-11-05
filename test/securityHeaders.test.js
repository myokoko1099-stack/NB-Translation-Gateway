import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  TOKEN,
  VALID,
  assertError,
  assertSecurityHeaders,
  bearer,
  countingProvider,
  get,
  postJsonRaw,
  post,
  preflight,
  rawRequest,
  throwingProvider,
  withServer,
} from './httpTestKit.js';

const ALLOWED = 'https://app.example.com';
const EVIL = 'https://evil.example.org';

const ENV = {
  GATEWAY_CLIENT_TOKEN: TOKEN,
  GATEWAY_RATE_LIMIT_MAX: '1000',
  GATEWAY_CORS_ALLOWED_ORIGINS: ALLOWED,
  MAX_BODY_BYTES: '1024',
};

/**
 * Security headers under test (Phase 05-B2.3):
 *   X-Content-Type-Options, Referrer-Policy, X-Frame-Options,
 *   Content-Security-Policy, Permissions-Policy
 * assertSecurityHeaders() checks value and "exactly once" for all five.
 */

describe('security headers - success responses (2xx)', () => {
  it('GET /health -> 200', async () => {
    await withServer(ENV, {}, async (srv) => {
      const res = await get(srv.baseUrl, '/health');
      assert.equal(res.status, 200);
      assertSecurityHeaders(res, 'GET /health');
    });
  });

  it('POST /v1/translate -> 200', async () => {
    const provider = countingProvider();
    await withServer(ENV, { provider }, async (srv) => {
      const res = await postJsonRaw(srv.baseUrl, VALID, bearer());
      assert.equal(res.status, 200);
      assertSecurityHeaders(res, 'POST /v1/translate');
    });
  });

  it('a success response for an allowed CORS origin', async () => {
    await withServer(ENV, {}, async (srv) => {
      const res = await get(srv.baseUrl, '/health', { origin: ALLOWED });
      assert.equal(res.status, 200);
      assertSecurityHeaders(res, 'allowed origin');
    });
  });
});

describe('security headers - error responses', () => {
  it('400 INVALID_REQUEST / INVALID_JSON', async () => {
    await withServer(ENV, {}, async (srv) => {
      const invalid = await postJsonRaw(srv.baseUrl, {}, bearer());
      assertError(invalid, 400, 'INVALID_REQUEST');
      assertSecurityHeaders(invalid, '400 validation');

      const notJson = await postJsonRaw(srv.baseUrl, '{not json', bearer());
      assertError(notJson, 400, 'INVALID_JSON');
      assertSecurityHeaders(notJson, '400 invalid json');
    });
  });

  it('401 UNAUTHORIZED', async () => {
    await withServer(ENV, {}, async (srv) => {
      const none = await postJsonRaw(srv.baseUrl, VALID);
      assertError(none, 401, 'UNAUTHORIZED');
      assertSecurityHeaders(none, '401 no token');
      const wrong = await postJsonRaw(srv.baseUrl, VALID, bearer('wrong-token-value'));
      assertError(wrong, 401, 'UNAUTHORIZED');
      assertSecurityHeaders(wrong, '401 wrong token');
    });
  });

  it('405 METHOD_NOT_ALLOWED', async () => {
    await withServer(ENV, {}, async (srv) => {
      const res = await rawRequest(srv.baseUrl, { method: 'GET', path: '/v1/translate' });
      assertError(res, 405, 'METHOD_NOT_ALLOWED');
      assertSecurityHeaders(res, '405');
    });
  });

  it('413 PAYLOAD_TOO_LARGE', async () => {
    await withServer(ENV, {}, async (srv) => {
      const res = await postJsonRaw(srv.baseUrl, 'x'.repeat(2048), bearer());
      assertError(res, 413, 'PAYLOAD_TOO_LARGE');
      assertSecurityHeaders(res, '413');
    });
  });

  it('415 UNSUPPORTED_MEDIA_TYPE', async () => {
    await withServer(ENV, {}, async (srv) => {
      const res = await post(srv.baseUrl, { headers: { ...bearer(), 'content-type': 'text/plain' }, body: 'x' });
      assertError(res, 415, 'UNSUPPORTED_MEDIA_TYPE');
      assertSecurityHeaders(res, '415');
    });
  });

  it('429 RATE_LIMITED', async () => {
    await withServer({ ...ENV, GATEWAY_RATE_LIMIT_MAX: '1' }, { provider: countingProvider() }, async (srv) => {
      assert.equal((await postJsonRaw(srv.baseUrl, VALID, bearer())).status, 200);
      const res = await postJsonRaw(srv.baseUrl, VALID, bearer());
      assertError(res, 429, 'RATE_LIMITED');
      assertSecurityHeaders(res, '429');
    });
  });

  it('501 NOT_IMPLEMENTED (no provider injected)', async () => {
    await withServer(ENV, {}, async (srv) => {
      const res = await postJsonRaw(srv.baseUrl, VALID, bearer());
      assertError(res, 501, 'NOT_IMPLEMENTED');
      assertSecurityHeaders(res, '501');
    });
  });

  it('500 INTERNAL_ERROR (provider throws)', async () => {
    await withServer(ENV, { provider: throwingProvider() }, async (srv) => {
      const res = await postJsonRaw(srv.baseUrl, VALID, bearer());
      assertError(res, 500, 'INTERNAL_ERROR');
      assertSecurityHeaders(res, '500');
      assert.ok(!res.text.includes('boom'), 'internal error message must not leak');
    });
  });

  it('408 REQUEST_TIMEOUT (incomplete body)', async () => {
    await withServer({ ...ENV, REQUEST_TIMEOUT_MS: '1000' }, {}, async (srv) => {
      const res = await post(srv.baseUrl, {
        headers: { ...bearer(), 'content-type': 'application/json', 'content-length': '100' },
        hold: '{"sourceLanguage":',
      });
      assertError(res, 408, 'REQUEST_TIMEOUT');
      assertSecurityHeaders(res, '408');
    });
  });
});

describe('security headers - 404, 403 and 204', () => {
  it('404 NOT_FOUND (native client and allowed origin)', async () => {
    await withServer(ENV, {}, async (srv) => {
      const native = await get(srv.baseUrl, '/nope');
      assertError(native, 404, 'NOT_FOUND');
      assertSecurityHeaders(native, '404 native');
      const browser = await get(srv.baseUrl, '/nope', { origin: ALLOWED });
      assertError(browser, 404, 'NOT_FOUND');
      assertSecurityHeaders(browser, '404 allowed origin');
    });
  });

  it('403 ORIGIN_NOT_ALLOWED (unknown origin, null origin)', async () => {
    await withServer(ENV, {}, async (srv) => {
      for (const origin of [EVIL, 'null']) {
        const res = await get(srv.baseUrl, '/health', { origin });
        assertError(res, 403, 'ORIGIN_NOT_ALLOWED');
        assertSecurityHeaders(res, `403 origin ${origin}`);
      }
    });
  });

  it('403 CORS_PREFLIGHT_REJECTED (bad method, bad headers)', async () => {
    await withServer(ENV, {}, async (srv) => {
      const method = await preflight(srv.baseUrl, { origin: ALLOWED, method: 'DELETE' });
      assertError(method, 403, 'CORS_PREFLIGHT_REJECTED');
      assertSecurityHeaders(method, '403 preflight method');
      const headers = await preflight(srv.baseUrl, { origin: ALLOWED, requestHeaders: 'x-evil' });
      assertError(headers, 403, 'CORS_PREFLIGHT_REJECTED');
      assertSecurityHeaders(headers, '403 preflight headers');
    });
  });

  it('403 when the allowlist is empty', async () => {
    await withServer({ GATEWAY_CLIENT_TOKEN: TOKEN }, {}, async (srv) => {
      const res = await get(srv.baseUrl, '/health', { origin: ALLOWED });
      assertError(res, 403, 'ORIGIN_NOT_ALLOWED');
      assertSecurityHeaders(res, '403 empty allowlist');
    });
  });

  it('204 preflight (both routes)', async () => {
    await withServer(ENV, {}, async (srv) => {
      const translate = await preflight(srv.baseUrl, { origin: ALLOWED });
      assert.equal(translate.status, 204);
      assert.equal(translate.text, '');
      assertSecurityHeaders(translate, '204 /v1/translate');

      const health = await preflight(srv.baseUrl, { path: '/health', origin: ALLOWED, method: 'GET', requestHeaders: null });
      assert.equal(health.status, 204);
      assertSecurityHeaders(health, '204 /health');
    });
  });
});

describe('security headers - exact values', () => {
  it('values are strict for a JSON-only API (nosniff, no-referrer, DENY, default-src none, features off)', async () => {
    await withServer(ENV, {}, async (srv) => {
      const h = (await get(srv.baseUrl, '/health')).headers;
      assert.equal(h['x-content-type-options'], 'nosniff');
      assert.equal(h['referrer-policy'], 'no-referrer');
      assert.equal(h['x-frame-options'], 'DENY');
      assert.equal(h['content-security-policy'], "default-src 'none'; frame-ancestors 'none'");
      for (const feature of [
        'accelerometer=()',
        'camera=()',
        'geolocation=()',
        'gyroscope=()',
        'magnetometer=()',
        'microphone=()',
        'payment=()',
        'usb=()',
      ]) {
        assert.ok(h['permissions-policy'].includes(feature), feature);
      }
    });
  });

  it('the CSP forbids framing and every default source (no unsafe-inline / wildcard)', async () => {
    await withServer(ENV, {}, async (srv) => {
      const csp = (await get(srv.baseUrl, '/health')).headers['content-security-policy'];
      assert.ok(csp.includes("default-src 'none'"));
      assert.ok(csp.includes("frame-ancestors 'none'"));
      assert.ok(!csp.includes('unsafe'));
      assert.ok(!csp.includes('*'));
    });
  });

  it('headers are identical across a success and an error response', async () => {
    await withServer(ENV, {}, async (srv) => {
      const ok = await get(srv.baseUrl, '/health');
      const err = await get(srv.baseUrl, '/nope');
      for (const name of [
        'x-content-type-options',
        'referrer-policy',
        'x-frame-options',
        'content-security-policy',
        'permissions-policy',
      ]) {
        assert.equal(ok.headers[name], err.headers[name], name);
      }
    });
  });
});

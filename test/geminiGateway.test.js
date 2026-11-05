import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadAuthConfig } from '../src/config/auth.js';
import { loadConfig } from '../src/config/config.js';
import { EnvSecretProvider } from '../src/config/secrets.js';
import { loadTranslationProviderConfig } from '../src/config/translationProvider.js';
import { AppError } from '../src/domain/errors.js';
import { createLogger } from '../src/infrastructure/logging/logger.js';
import { createProvider } from '../src/infrastructure/providers/createProvider.js';
import { GEMINI_ENDPOINT } from '../src/infrastructure/providers/geminiProvider.js';
import {
  TOKEN,
  UUID,
  VALID,
  assertError,
  assertSecurityHeaders,
  bearer,
  post,
  postJsonRaw,
  preflight,
  throwingProvider,
  withServer,
} from './httpTestKit.js';

/**
 * Phase 05-B3 (3/3): the Gemini provider behind the real HTTP server.
 * Mock fetch only - the real Gemini API is never called and no real key is used.
 * Covers error mapping through errorResponse.js, secret redaction, and
 * regressions for authentication, rate limiting and HTTP security.
 */

const KEY = 'gateway-test-gemini-key-9876543210';
const NOVEL_TEXT = 'SENTINEL-NOVEL-TEXT-GATEWAY';
const TRANSLATED_TEXT = 'SENTINEL-TRANSLATED-TEXT-GATEWAY';
const UPSTREAM_RAW = 'SENTINEL-UPSTREAM-RAW-GATEWAY';

const completed = (text) => ({
  status: 'completed',
  steps: [{ type: 'model_output', content: [{ type: 'text', text }] }],
});
const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function mockFetch(handler) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init, calls.length);
  };
  fn.calls = calls;
  return fn;
}

// AbortSignal.timeout() uses an unref'd timer, so while this promise is pending nothing
// else keeps the event loop alive and node:test would cancel the test. The (ref'd)
// keep-alive timer below holds the loop open until the abort fires.
const hangingFetch = (_url, init) =>
  new Promise((_resolve, reject) => {
    const keepAlive = setTimeout(() => {}, 30_000);
    init.signal.addEventListener(
      'abort',
      () => {
        clearTimeout(keepAlive);
        reject(init.signal.reason);
      },
      { once: true },
    );
  });

/** Build the Gemini provider exactly like src/index.js does (config -> createProvider). */
function geminiProvider({ fetchImpl, timeoutMs } = {}) {
  const env = { TRANSLATION_PROVIDER: 'gemini', GEMINI_API_KEY: KEY };
  const providerLogs = [];
  const logger = createLogger('debug', (line) => providerLogs.push(line));
  const config = loadTranslationProviderConfig(env, new EnvSecretProvider(env));
  const effective = timeoutMs ? { ...config, gemini: { ...config.gemini, timeoutMs } } : config;
  return { provider: createProvider(effective, { fetchImpl, logger }), providerLogs };
}

/** Run `fn` against a real server wired to the Gemini provider (authentication enabled). */
function run({ fetchImpl, env = {}, timeoutMs }, fn) {
  const { provider, providerLogs } = geminiProvider({ fetchImpl, timeoutMs });
  return withServer({ GATEWAY_CLIENT_TOKEN: TOKEN, ...env }, { provider }, (srv) => fn({ ...srv, providerLogs }));
}

const send = (srv, payload = VALID, headers = bearer()) => postJsonRaw(srv.baseUrl, payload, headers);

describe('B3 gateway - successful translation', () => {
  it('200 with the translated text and all B2.3 security headers', async () => {
    const fetchImpl = mockFetch(() => json(completed('မင်္ဂလာပါ')));
    await run({ fetchImpl }, async (srv) => {
      const res = await send(srv);
      assert.equal(res.status, 200);
      assert.deepEqual(res.json(), {
        translatedText: 'မင်္ဂလာပါ',
        sourceLanguage: 'ja',
        targetLanguage: 'my',
        provider: 'gemini',
      });
      assertSecurityHeaders(res, 'success');
      assert.match(res.headers['x-request-id'], UUID);
      assert.equal(res.headers['cache-control'], 'no-store');
    });
    assert.equal(fetchImpl.calls.length, 1);
  });

  it('calls Gemini with its own key; the client token is never forwarded', async () => {
    const fetchImpl = mockFetch(() => json(completed('ok')));
    await run({ fetchImpl }, async (srv) => {
      assert.equal((await send(srv)).status, 200);
    });
    const { url, init } = fetchImpl.calls[0];
    assert.equal(url, GEMINI_ENDPOINT);
    assert.equal(init.headers['x-goog-api-key'], KEY);
    assert.equal(init.headers.authorization, undefined);
    assert.ok(!JSON.stringify(init).includes(TOKEN));
    const body = JSON.parse(init.body);
    assert.equal(body.store, false);
    assert.equal(body.model, 'gemini-3.1-flash-lite');
    assert.equal(body.input, VALID.text);
  });
});

describe('B3 gateway - upstream errors reach the client sanitised', () => {
  const CASES = [
    [400, 502, 'UPSTREAM_ERROR', 'Upstream service error.'],
    [401, 502, 'UPSTREAM_ERROR', 'Upstream service error.'],
    [403, 502, 'UPSTREAM_ERROR', 'Upstream service error.'],
    [404, 502, 'UPSTREAM_ERROR', 'Upstream service error.'],
    [500, 502, 'UPSTREAM_ERROR', 'Upstream service error.'],
    [503, 503, 'UPSTREAM_UNAVAILABLE', 'Service unavailable.'],
    [429, 429, 'UPSTREAM_RATE_LIMITED', 'Upstream service is rate limited. Try again later.'],
    [504, 504, 'UPSTREAM_TIMEOUT', 'Upstream service timed out.'],
  ];

  for (const [upstream, status, code, message] of CASES) {
    it(`Gemini ${upstream} -> ${status} ${code}`, async () => {
      const fetchImpl = mockFetch(() =>
        json({ error: { code: upstream, message: UPSTREAM_RAW, details: [{ key: KEY }] } }, upstream, { 'retry-after': '99' }),
      );
      await run({ fetchImpl }, async (srv) => {
        const res = await send(srv);
        const body = assertError(res, status, code);
        assert.equal(body.error.message, message);
        assert.equal(body.error.details, undefined);
        assertSecurityHeaders(res, `upstream ${upstream}`);
        // The upstream Retry-After is not forwarded; only the gateway's own rate headers exist.
        assert.equal(res.headers['retry-after'], undefined);
        assert.ok(!res.text.includes(UPSTREAM_RAW));
        assert.ok(!res.text.includes(KEY));
        assert.ok(!res.text.includes('generativelanguage'));
        const logs = [...srv.logs, ...srv.providerLogs].join('\n');
        assert.ok(!logs.includes(UPSTREAM_RAW));
        assert.ok(!logs.includes(KEY));
      });
      assert.equal(fetchImpl.calls.length, 1, 'no automatic retry');
    });
  }

  it('network failure -> 502', async () => {
    const fetchImpl = mockFetch(() => {
      throw new TypeError('fetch failed', { cause: Object.assign(new Error(`getaddrinfo ENOTFOUND ${UPSTREAM_RAW}`), { code: 'ENOTFOUND' }) });
    });
    await run({ fetchImpl }, async (srv) => {
      const res = await send(srv);
      assertError(res, 502, 'UPSTREAM_ERROR');
      assertSecurityHeaders(res, 'network');
      assert.ok(!res.text.includes(UPSTREAM_RAW));
      assert.ok(![...srv.logs, ...srv.providerLogs].join('\n').includes(UPSTREAM_RAW));
    });
  });

  it('invalid JSON and empty / incomplete responses -> 502', async () => {
    const handlers = [
      () => new Response(`<html>${UPSTREAM_RAW}</html>`, { status: 200 }),
      () => json(completed('   ')),
      () => json({ ...completed(TRANSLATED_TEXT), status: 'incomplete' }),
    ];
    for (const handler of handlers) {
      await run({ fetchImpl: mockFetch(handler) }, async (srv) => {
        const res = await send(srv);
        assertError(res, 502, 'UPSTREAM_ERROR');
        assert.ok(!res.text.includes(UPSTREAM_RAW));
        assert.ok(!res.text.includes(TRANSLATED_TEXT));
      });
    }
  });

  it('timeout -> 504 UPSTREAM_TIMEOUT', async () => {
    await run({ fetchImpl: hangingFetch, timeoutMs: 30 }, async (srv) => {
      const res = await send(srv);
      assertError(res, 504, 'UPSTREAM_TIMEOUT');
      assertSecurityHeaders(res, 'timeout');
    });
  });

  it('a 5xx is logged by request id, status and code only', async () => {
    const fetchImpl = mockFetch(() => json({ error: { message: UPSTREAM_RAW } }, 400));
    await run({ fetchImpl }, async (srv) => {
      const res = await send(srv);
      const { requestId } = assertError(res, 502, 'UPSTREAM_ERROR').error;
      const line = srv.logs.map((l) => JSON.parse(l)).find((l) => l.message === 'server error');
      assert.ok(line, 'expected a "server error" log line');
      assert.equal(line.level, 'error');
      assert.equal(line.requestId, requestId);
      assert.equal(line.status, 502);
      assert.equal(line.code, 'UPSTREAM_ERROR');
      assert.deepEqual(Object.keys(line).sort(), ['code', 'level', 'message', 'requestId', 'status', 'time']);
    });
  });
});

describe('B3 gateway - errorResponse.js is wired into the server', () => {
  it('a 5xx AppError from any provider keeps only status and code (no message, details or headers)', async () => {
    const leaky = {
      id: 'leaky-double',
      async translate() {
        throw new AppError(502, 'UPSTREAM_ERROR', 'RAW-LEAK-SENTINEL Bearer abc123 api_key=hunter2hunter2', [{ issue: 'RAW-LEAK-SENTINEL' }], {
          'x-internal': 'RAW-LEAK-SENTINEL',
        });
      },
    };
    await withServer({ GATEWAY_CLIENT_TOKEN: TOKEN }, { provider: leaky }, async (srv) => {
      const res = await send(srv);
      const body = assertError(res, 502, 'UPSTREAM_ERROR');
      assert.equal(body.error.message, 'Upstream service error.');
      assert.equal(body.error.details, undefined);
      assert.equal(res.headers['x-internal'], undefined);
      assert.ok(!res.text.includes('RAW-LEAK-SENTINEL'));
      assert.ok(!srv.logs.join('\n').includes('RAW-LEAK-SENTINEL'));
    });
  });

  it('an unexpected error is a generic 500 and is logged by redacted name/message only', async () => {
    await withServer({ GATEWAY_CLIENT_TOKEN: TOKEN }, { provider: throwingProvider() }, async (srv) => {
      const res = await send(srv);
      const body = assertError(res, 500, 'INTERNAL_ERROR');
      assert.equal(body.error.message, 'Internal server error.');
      assert.ok(!res.text.includes('boom'));
      const line = srv.logs.map((l) => JSON.parse(l)).find((l) => l.message === 'unhandled error');
      assert.ok(line);
      assert.equal(line.errorName, 'Error');
      assert.equal(line.stack, undefined);
    });
  });

  it('client-safe 4xx errors keep their message and headers', async () => {
    await withServer({ GATEWAY_CLIENT_TOKEN: TOKEN }, { provider: geminiProvider({ fetchImpl: mockFetch(() => json(completed('x'))) }).provider }, async (srv) => {
      const unauthorized = await send(srv, VALID, {});
      assertError(unauthorized, 401, 'UNAUTHORIZED');
      assert.equal(unauthorized.headers['www-authenticate'], 'Bearer');
      const invalid = await send(srv, { ...VALID, extra: 1 });
      const body = assertError(invalid, 400, 'INVALID_REQUEST');
      assert.deepEqual(body.error.details, [{ field: 'extra', issue: 'unknown field' }]);
    });
  });
});

describe('B3 gateway - provider none keeps the 501 behaviour', () => {
  it('501 NOT_IMPLEMENTED, never a fabricated translation', async () => {
    const env = {};
    const provider = createProvider(loadTranslationProviderConfig(env, new EnvSecretProvider(env)));
    assert.equal(provider, null);
    await withServer({ GATEWAY_CLIENT_TOKEN: TOKEN }, { provider }, async (srv) => {
      const res = await send(srv);
      const body = assertError(res, 501, 'NOT_IMPLEMENTED');
      assert.equal(body.error.message, 'Not implemented.');
      assert.equal(body.translatedText, undefined);
      assertSecurityHeaders(res, '501');
    });
  });
});

describe('B3 regression - authentication', () => {
  it('missing, wrong and malformed tokens -> 401 and Gemini is never called', async () => {
    const fetchImpl = mockFetch(() => json(completed('x')));
    await run({ fetchImpl }, async (srv) => {
      for (const headers of [{}, bearer('wrong-token-value'), { authorization: `Basic ${TOKEN}` }, { authorization: 'Bearer' }]) {
        const res = await send(srv, VALID, headers);
        assertError(res, 401, 'UNAUTHORIZED');
        assert.equal(res.headers['www-authenticate'], 'Bearer');
        assertSecurityHeaders(res, '401');
      }
      // Authentication runs before body parsing and validation.
      assertError(await postJsonRaw(srv.baseUrl, '{not json'), 401, 'UNAUTHORIZED');
      assertError(await postJsonRaw(srv.baseUrl, {}), 401, 'UNAUTHORIZED');
    });
    assert.equal(fetchImpl.calls.length, 0);
  });

  it('a valid token still reaches Gemini exactly once', async () => {
    const fetchImpl = mockFetch(() => json(completed('x')));
    await run({ fetchImpl }, async (srv) => {
      assert.equal((await send(srv)).status, 200);
    });
    assert.equal(fetchImpl.calls.length, 1);
  });
});

describe('B3 regression - rate limiting', () => {
  it('requests over the limit -> 429 RATE_LIMITED before Gemini is called', async () => {
    const fetchImpl = mockFetch(() => json(completed('x')));
    await run({ fetchImpl, env: { GATEWAY_RATE_LIMIT_MAX: '2', GATEWAY_RATE_LIMIT_WINDOW_MS: '60000' } }, async (srv) => {
      for (let i = 0; i < 2; i += 1) {
        const ok = await send(srv);
        assert.equal(ok.status, 200);
        assert.equal(ok.headers['ratelimit-limit'], '2');
      }
      const limited = await send(srv);
      assertError(limited, 429, 'RATE_LIMITED');
      assert.ok(Number(limited.headers['retry-after']) >= 1);
      assertSecurityHeaders(limited, '429');
    });
    assert.equal(fetchImpl.calls.length, 2, 'the limited request must not reach Gemini');
  });

  it('the gateway limit and the upstream limit have different codes', async () => {
    const fetchImpl = mockFetch(() => json({ error: 'x' }, 429));
    await run({ fetchImpl, env: { GATEWAY_RATE_LIMIT_MAX: '1' } }, async (srv) => {
      assertError(await send(srv), 429, 'UPSTREAM_RATE_LIMITED');
      assertError(await send(srv), 429, 'RATE_LIMITED');
    });
  });
});

describe('B3 regression - HTTP security (CORS, content type, size, validation)', () => {
  const ORIGIN = 'https://app.example.com';

  it('an allowed origin gets CORS headers on success and on upstream errors', async () => {
    let n = 0;
    const fetchImpl = mockFetch(() => (++n === 1 ? json(completed('x')) : json({ error: 'x' }, 500)));
    await run({ fetchImpl, env: { GATEWAY_CORS_ALLOWED_ORIGINS: ORIGIN } }, async (srv) => {
      const ok = await send(srv, VALID, { ...bearer(), origin: ORIGIN });
      assert.equal(ok.status, 200);
      assert.equal(ok.headers['access-control-allow-origin'], ORIGIN);
      assert.notEqual(ok.headers['access-control-allow-origin'], '*');
      assertSecurityHeaders(ok, 'cors success');

      const failed = await send(srv, VALID, { ...bearer(), origin: ORIGIN });
      assertError(failed, 502, 'UPSTREAM_ERROR');
      assert.equal(failed.headers['access-control-allow-origin'], ORIGIN);
      assertSecurityHeaders(failed, 'cors error');
    });
  });

  it('a disallowed or null origin -> 403 and Gemini is never called', async () => {
    const fetchImpl = mockFetch(() => json(completed('x')));
    await run({ fetchImpl, env: { GATEWAY_CORS_ALLOWED_ORIGINS: ORIGIN } }, async (srv) => {
      for (const origin of ['https://evil.example', 'null']) {
        const res = await send(srv, VALID, { ...bearer(), origin });
        assertError(res, 403, 'ORIGIN_NOT_ALLOWED');
        assert.equal(res.headers['access-control-allow-origin'], undefined);
        assertSecurityHeaders(res, 'origin rejected');
      }
    });
    assert.equal(fetchImpl.calls.length, 0);
  });

  it('a CORS preflight is answered without calling Gemini', async () => {
    const fetchImpl = mockFetch(() => json(completed('x')));
    await run({ fetchImpl, env: { GATEWAY_CORS_ALLOWED_ORIGINS: ORIGIN } }, async (srv) => {
      const res = await preflight(srv.baseUrl, { origin: ORIGIN });
      assert.equal(res.status, 204);
      assert.equal(res.headers['access-control-allow-origin'], ORIGIN);
      assertSecurityHeaders(res, 'preflight');
    });
    assert.equal(fetchImpl.calls.length, 0);
  });

  it('415, 413 and validation errors never reach Gemini', async () => {
    const fetchImpl = mockFetch(() => json(completed('x')));
    await run({ fetchImpl, env: { MAX_BODY_BYTES: '2048', MAX_TEXT_CHARS: '50' } }, async (srv) => {
      const wrongType = await post(srv.baseUrl, {
        headers: { ...bearer(), 'content-type': 'text/plain' },
        body: JSON.stringify(VALID),
      });
      assertError(wrongType, 415, 'UNSUPPORTED_MEDIA_TYPE');
      assertSecurityHeaders(wrongType, '415');

      const tooLarge = await send(srv, { ...VALID, text: 'x'.repeat(5000) });
      assertError(tooLarge, 413, 'PAYLOAD_TOO_LARGE');
      assertSecurityHeaders(tooLarge, '413');

      assertError(await send(srv, { ...VALID, text: 'a'.repeat(51) }), 400, 'INVALID_REQUEST');
      assertError(await send(srv, { ...VALID, targetLanguage: 'auto' }), 400, 'INVALID_REQUEST');
      assertError(await postJsonRaw(srv.baseUrl, '{not json', bearer()), 400, 'INVALID_JSON');
    });
    assert.equal(fetchImpl.calls.length, 0);
  });
});

describe('B3 gateway - secret and text exposure', () => {
  it('neither responses nor logs ever contain the API key, the client token or the text', async () => {
    const handlers = [
      () => json(completed(TRANSLATED_TEXT)),
      () => json({ error: { message: `${UPSTREAM_RAW} ${KEY}` } }, 401),
      () => {
        throw new Error(`failed ${KEY} ${NOVEL_TEXT}`);
      },
      () => new Response(`${KEY} ${NOVEL_TEXT}`, { status: 200 }),
    ];
    for (const handler of handlers) {
      await run({ fetchImpl: mockFetch(handler) }, async (srv) => {
        const res = await send(srv, { ...VALID, text: NOVEL_TEXT });
        const logs = [...srv.logs, ...srv.providerLogs].join('\n');
        for (const secret of [KEY, TOKEN]) {
          assert.ok(!res.text.includes(secret), 'secret in response');
          assert.ok(!logs.includes(secret), 'secret in logs');
        }
        assert.ok(!logs.includes(NOVEL_TEXT), 'request text in logs');
        assert.ok(!logs.includes(TRANSLATED_TEXT), 'translated text in logs');
        assert.ok(!logs.includes('"authorization"'));
        assert.ok(logs.length > 0);
      });
    }
  });

  it('src/index.js style logger wiring scrubs the exact key and client token values', () => {
    const env = { NODE_ENV: 'test', GATEWAY_CLIENT_TOKEN: TOKEN, TRANSLATION_PROVIDER: 'gemini', GEMINI_API_KEY: KEY };
    const secrets = new EnvSecretProvider(env);
    const auth = loadAuthConfig(loadConfig(env), secrets);
    const providerConfig = loadTranslationProviderConfig(env, secrets);

    const lines = [];
    const logger = createLogger('debug', (line) => lines.push(line), { secrets: [auth.token, providerConfig.gemini?.apiKey] });
    logger.error(`leak attempt ${KEY} / ${TOKEN}`, {
      note: `prefix-${KEY}-suffix`,
      nested: { value: TOKEN },
      key: providerConfig.gemini.apiKey,
    });
    const output = lines.join('\n');
    assert.ok(!output.includes(KEY));
    assert.ok(!output.includes(TOKEN));
    assert.ok(output.includes('[REDACTED]'));
  });
});

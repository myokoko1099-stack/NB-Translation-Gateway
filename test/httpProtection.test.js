import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  TOKEN,
  VALID,
  assertError,
  assertSecurityHeaders,
  bearer,
  countingProvider,
  post,
  postJsonRaw,
  withServer,
} from './httpTestKit.js';

const MAX = 1024;
const ENV = {
  GATEWAY_CLIENT_TOKEN: TOKEN,
  GATEWAY_RATE_LIMIT_MAX: '1000',
  MAX_BODY_BYTES: String(MAX),
  REQUEST_TIMEOUT_MS: '1000', // the minimum the config accepts
};

const JSON_BODY = JSON.stringify(VALID);

/** POST with an explicit Content-Type (undefined = header omitted). */
function postWithType(baseUrl, contentType, body = JSON_BODY, extra = {}) {
  const headers = { ...bearer(), 'content-length': Buffer.byteLength(body), ...extra };
  if (contentType !== undefined) headers['content-type'] = contentType;
  return post(baseUrl, { headers, body });
}

function assertClosed(res, label) {
  assert.equal(res.headers.connection, 'close', `Connection: close expected [${label}]`);
  assertSecurityHeaders(res, label);
}

/* ------------------------------------------------------------------ */
describe('HTTP protection - Content-Type -> 415', () => {
  it('missing Content-Type -> 415 UNSUPPORTED_MEDIA_TYPE, provider not called', async () => {
    const provider = countingProvider();
    await withServer(ENV, { provider }, async (srv) => {
      const res = await postWithType(srv.baseUrl, undefined);
      assertError(res, 415, 'UNSUPPORTED_MEDIA_TYPE');
      assertClosed(res, 'missing content-type');
      assert.equal(provider.calls, 0);
    });
  });

  it('invalid media types -> 415', async () => {
    const provider = countingProvider();
    await withServer(ENV, { provider }, async (srv) => {
      for (const type of [
        'text/plain',
        'text/json',
        'application/xml',
        'application/x-www-form-urlencoded',
        'multipart/form-data; boundary=x',
        'application/jsonp',
        'application/json-patch+json',
        'application/vnd.api+json',
        'application/octet-stream',
        '',
      ]) {
        const res = await postWithType(srv.baseUrl, type);
        assertError(res, 415, 'UNSUPPORTED_MEDIA_TYPE');
        assertClosed(res, `content-type "${type}"`);
      }
      assert.equal(provider.calls, 0);
    });
  });

  it('application/json is accepted case-insensitively, with or without a UTF-8 charset', async () => {
    const provider = countingProvider();
    await withServer(ENV, { provider }, async (srv) => {
      const accepted = [
        'application/json',
        'APPLICATION/JSON',
        'application/json; charset=utf-8',
        'application/json; charset=UTF-8',
        'application/json;charset=utf8',
        'application/json; charset="utf-8"',
      ];
      for (const type of accepted) {
        const res = await postWithType(srv.baseUrl, type);
        assert.equal(res.status, 200, type);
      }
      assert.equal(provider.calls, accepted.length);
    });
  });

  it('the 415 body does not echo the submitted Content-Type', async () => {
    await withServer(ENV, {}, async (srv) => {
      const res = await postWithType(srv.baseUrl, 'text/x-sentinel-media-type');
      assertError(res, 415, 'UNSUPPORTED_MEDIA_TYPE');
      assert.ok(!res.text.includes('sentinel-media-type'));
      assert.ok(!srv.logs.join('\n').includes('sentinel-media-type'));
    });
  });
});

/* ------------------------------------------------------------------ */
describe('HTTP protection - invalid charset -> 415', () => {
  it('any charset other than UTF-8 -> 415, provider not called', async () => {
    const provider = countingProvider();
    await withServer(ENV, { provider }, async (srv) => {
      for (const type of [
        'application/json; charset=iso-8859-1',
        'application/json; charset=utf-16',
        'application/json; charset=us-ascii',
        'application/json; charset=ascii',
        'application/json; charset=utf-8x',
        'application/json; charset="latin1"',
        'application/json; charset=',
        'application/json; CHARSET=Shift_JIS',
      ]) {
        const res = await postWithType(srv.baseUrl, type);
        assertError(res, 415, 'UNSUPPORTED_MEDIA_TYPE');
        assertClosed(res, type);
      }
      assert.equal(provider.calls, 0);
    });
  });
});

/* ------------------------------------------------------------------ */
describe('HTTP protection - oversized body -> 413', () => {
  it('oversized Content-Length with the full body sent -> 413 PAYLOAD_TOO_LARGE', async () => {
    const provider = countingProvider();
    await withServer(ENV, { provider }, async (srv) => {
      const res = await postJsonRaw(srv.baseUrl, 'x'.repeat(MAX + 1), bearer());
      assertError(res, 413, 'PAYLOAD_TOO_LARGE');
      assertClosed(res, '413 content-length');
      assert.equal(provider.calls, 0);
    });
  });

  it('boundary: exactly MAX_BODY_BYTES is accepted, one byte more is refused', async () => {
    const provider = countingProvider();
    await withServer(ENV, { provider }, async (srv) => {
      const padded = JSON_BODY + ' '.repeat(MAX - Buffer.byteLength(JSON_BODY));
      assert.equal(Buffer.byteLength(padded), MAX);
      assert.equal((await postJsonRaw(srv.baseUrl, padded, bearer())).status, 200);
      assertError(await postJsonRaw(srv.baseUrl, `${padded} `, bearer()), 413, 'PAYLOAD_TOO_LARGE');
      assert.equal(provider.calls, 1);
    });
  });

  it('an oversized DECLARED length is refused immediately, without waiting for the body', async () => {
    const provider = countingProvider();
    await withServer(ENV, { provider }, async (srv) => {
      // Only a few bytes are sent and the request is never finished; the server must
      // answer from the header alone instead of waiting for (or timing out on) the body.
      const startedAt = Date.now();
      const res = await post(srv.baseUrl, {
        headers: { ...bearer(), 'content-type': 'application/json', 'content-length': '99999999' },
        hold: '{"a":',
      });
      assertError(res, 413, 'PAYLOAD_TOO_LARGE');
      assertClosed(res, '413 declared');
      assert.ok(Date.now() - startedAt < 900, 'must not wait for the request timeout (1000 ms)');
      assert.equal(provider.calls, 0);
    });
  });

  it('oversized STREAMED (chunked, no Content-Length) body -> 413', async () => {
    const provider = countingProvider();
    await withServer(ENV, { provider }, async (srv) => {
      const res = await post(srv.baseUrl, {
        headers: { ...bearer(), 'content-type': 'application/json', 'transfer-encoding': 'chunked' },
        chunks: ['a'.repeat(512), 'b'.repeat(512), 'c'.repeat(512), 'd'.repeat(512)],
      });
      assertError(res, 413, 'PAYLOAD_TOO_LARGE');
      assertClosed(res, '413 streamed');
      assert.equal(provider.calls, 0);
    });
  });

  it('a streamed body within the limit is accepted', async () => {
    const provider = countingProvider();
    await withServer(ENV, { provider }, async (srv) => {
      const half = Math.floor(JSON_BODY.length / 2);
      const res = await post(srv.baseUrl, {
        headers: { ...bearer(), 'content-type': 'application/json', 'transfer-encoding': 'chunked' },
        chunks: [JSON_BODY.slice(0, half), JSON_BODY.slice(half)],
      });
      assert.equal(res.status, 200);
      assert.equal(provider.calls, 1);
    });
  });

  it('413 is evaluated after Content-Type: wrong type + oversized length -> 415', async () => {
    await withServer(ENV, {}, async (srv) => {
      const res = await postWithType(srv.baseUrl, 'text/plain', 'x'.repeat(MAX + 1));
      assertError(res, 415, 'UNSUPPORTED_MEDIA_TYPE');
    });
  });

  it('the 413 body and logs never contain the submitted payload', async () => {
    await withServer(ENV, {}, async (srv) => {
      const res = await postJsonRaw(srv.baseUrl, 'SENTINEL-OVERSIZED-PAYLOAD'.repeat(100), bearer());
      assertError(res, 413, 'PAYLOAD_TOO_LARGE');
      assert.ok(!res.text.includes('SENTINEL-OVERSIZED'));
      assert.ok(!srv.logs.join('\n').includes('SENTINEL-OVERSIZED'));
    });
  });
});

/* ------------------------------------------------------------------ */
describe('HTTP protection - incomplete body -> 408', () => {
  it('a body that never completes -> 408 REQUEST_TIMEOUT, provider not called', async () => {
    const provider = countingProvider();
    await withServer(ENV, { provider }, async (srv) => {
      const startedAt = Date.now();
      const res = await post(srv.baseUrl, {
        headers: { ...bearer(), 'content-type': 'application/json', 'content-length': '200' },
        hold: '{"sourceLanguage":"ja",',
      });
      assertError(res, 408, 'REQUEST_TIMEOUT');
      assertClosed(res, '408');
      assert.ok(Date.now() - startedAt >= 900, 'should have waited for the configured timeout');
      assert.equal(provider.calls, 0);
    });
  });

  it('a chunked body that never ends -> 408', async () => {
    const provider = countingProvider();
    await withServer(ENV, { provider }, async (srv) => {
      const res = await post(srv.baseUrl, {
        headers: { ...bearer(), 'content-type': 'application/json', 'transfer-encoding': 'chunked' },
        hold: '{"sourceLanguage":"ja"',
      });
      assertError(res, 408, 'REQUEST_TIMEOUT');
      assert.equal(provider.calls, 0);
    });
  });
});

/* ------------------------------------------------------------------ */
describe('HTTP protection - invalid JSON and empty body -> 400', () => {
  it('malformed JSON -> 400 INVALID_JSON, provider not called', async () => {
    const provider = countingProvider();
    await withServer(ENV, { provider }, async (srv) => {
      for (const body of ['{not json', '{"a":', '{"a":1,}', "{'a':1}", 'undefined', 'hello', '{"a":1}}', '\u0000']) {
        const res = await postJsonRaw(srv.baseUrl, body, bearer());
        const parsed = assertError(res, 400, 'INVALID_JSON');
        assert.equal(parsed.error.message, 'Request body is not valid JSON.');
        assertSecurityHeaders(res, `invalid json ${JSON.stringify(body)}`);
      }
      assert.equal(provider.calls, 0);
    });
  });

  it('empty body (Content-Length: 0) -> 400 INVALID_JSON "Request body is required."', async () => {
    const provider = countingProvider();
    await withServer(ENV, { provider }, async (srv) => {
      const res = await postJsonRaw(srv.baseUrl, '', bearer());
      const parsed = assertError(res, 400, 'INVALID_JSON');
      assert.equal(parsed.error.message, 'Request body is required.');
      assert.equal(provider.calls, 0);
    });
  });

  it('no body at all (no Content-Length, nothing written) -> 400', async () => {
    const provider = countingProvider();
    await withServer(ENV, { provider }, async (srv) => {
      const res = await post(srv.baseUrl, { headers: { ...bearer(), 'content-type': 'application/json' } });
      assertError(res, 400, 'INVALID_JSON');
      assert.equal(provider.calls, 0);
    });
  });

  it('a whitespace-only body is not valid JSON -> 400', async () => {
    await withServer(ENV, {}, async (srv) => {
      assertError(await postJsonRaw(srv.baseUrl, '   \n  ', bearer()), 400, 'INVALID_JSON');
    });
  });

  it('valid JSON that is not a request object -> 400 INVALID_REQUEST (never a 500)', async () => {
    const provider = countingProvider();
    await withServer(ENV, { provider }, async (srv) => {
      for (const body of ['null', '[]', '"text"', '42', 'true']) {
        assertError(await postJsonRaw(srv.baseUrl, body, bearer()), 400, 'INVALID_REQUEST');
      }
      assert.equal(provider.calls, 0);
    });
  });

  it('the 400 body and logs never contain the submitted payload', async () => {
    await withServer(ENV, {}, async (srv) => {
      const res = await postJsonRaw(srv.baseUrl, '{"secret":"SENTINEL-BODY-VALUE" oops', bearer());
      assertError(res, 400, 'INVALID_JSON');
      assert.ok(!res.text.includes('SENTINEL-BODY-VALUE'));
      assert.ok(!srv.logs.join('\n').includes('SENTINEL-BODY-VALUE'));
    });
  });
});

/* ------------------------------------------------------------------ */
describe('HTTP protection - server keeps working after rejected requests', () => {
  it('a valid request succeeds right after 415 / 413 / 408 / 400 rejections', async () => {
    const provider = countingProvider();
    await withServer(ENV, { provider }, async (srv) => {
      await postWithType(srv.baseUrl, 'text/plain');
      await postJsonRaw(srv.baseUrl, 'x'.repeat(MAX + 1), bearer());
      await post(srv.baseUrl, {
        headers: { ...bearer(), 'content-type': 'application/json', 'content-length': '50' },
        hold: '{',
      });
      await postJsonRaw(srv.baseUrl, '{bad', bearer());
      const ok = await postJsonRaw(srv.baseUrl, VALID, bearer());
      assert.equal(ok.status, 200);
      assert.equal(provider.calls, 1);
    });
  });
});

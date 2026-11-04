import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createTranslateService } from '../src/application/translateService.js';
import { postJson, startTestServer } from './helpers.js';

const VALID = { sourceLanguage: 'ja', targetLanguage: 'my', text: 'こんにちは' };

describe('POST /v1/translate - invalid requests', () => {
  let srv;
  before(async () => {
    srv = await startTestServer({ MAX_TEXT_CHARS: '50', MAX_BODY_BYTES: '2048' });
  });
  after(() => srv.close());

  async function expectError(res, status, code) {
    assert.equal(res.status, status);
    const body = await res.json();
    assert.equal(body.error.code, code);
    assert.match(body.error.requestId, /^[0-9a-f-]{36}$/);
    return body.error;
  }

  it('400 INVALID_JSON for malformed JSON', async () => {
    await expectError(await postJson(srv.baseUrl, '/v1/translate', '{not json'), 400, 'INVALID_JSON');
  });

  it('400 INVALID_JSON for empty body', async () => {
    await expectError(await postJson(srv.baseUrl, '/v1/translate', ''), 400, 'INVALID_JSON');
  });

  it('415 when Content-Type is not JSON', async () => {
    const res = await fetch(`${srv.baseUrl}/v1/translate`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify(VALID),
    });
    await expectError(res, 415, 'UNSUPPORTED_MEDIA_TYPE');
  });

  it('413 when body exceeds MAX_BODY_BYTES', async () => {
    const res = await postJson(srv.baseUrl, '/v1/translate', { ...VALID, text: 'x'.repeat(5000) });
    await expectError(res, 413, 'PAYLOAD_TOO_LARGE');
  });

  it('400 INVALID_REQUEST when body is not an object', async () => {
    await expectError(await postJson(srv.baseUrl, '/v1/translate', '[1,2]'), 400, 'INVALID_REQUEST');
    await expectError(await postJson(srv.baseUrl, '/v1/translate', '"str"'), 400, 'INVALID_REQUEST');
  });

  it('400 lists every missing field', async () => {
    const err = await expectError(await postJson(srv.baseUrl, '/v1/translate', {}), 400, 'INVALID_REQUEST');
    assert.deepEqual(err.details.map((d) => d.field).sort(), ['sourceLanguage', 'targetLanguage', 'text']);
  });

  it('400 for wrong types, empty text and bad language tags', async () => {
    const err = await expectError(
      await postJson(srv.baseUrl, '/v1/translate', { sourceLanguage: 5, targetLanguage: 'not a tag!', text: '   ' }),
      400,
      'INVALID_REQUEST',
    );
    assert.deepEqual(err.details.map((d) => d.field).sort(), ['sourceLanguage', 'targetLanguage', 'text']);
  });

  it('400 when text exceeds MAX_TEXT_CHARS', async () => {
    const err = await expectError(
      await postJson(srv.baseUrl, '/v1/translate', { ...VALID, text: 'a'.repeat(51) }),
      400,
      'INVALID_REQUEST',
    );
    assert.equal(err.details[0].field, 'text');
  });

  it('400 for unknown fields', async () => {
    const err = await expectError(
      await postJson(srv.baseUrl, '/v1/translate', { ...VALID, apiKey: 'x' }),
      400,
      'INVALID_REQUEST',
    );
    assert.deepEqual(err.details, [{ field: 'apiKey', issue: 'unknown field' }]);
  });

  it('"auto" is allowed as source but not as target', async () => {
    await expectError(
      await postJson(srv.baseUrl, '/v1/translate', { ...VALID, targetLanguage: 'auto' }),
      400,
      'INVALID_REQUEST',
    );
  });

  it('error responses never echo the submitted text', async () => {
    const res = await postJson(srv.baseUrl, '/v1/translate', { ...VALID, text: 'SENTINEL-NOVEL-TEXT'.repeat(10), extra: 1 });
    assert.ok(!(await res.text()).includes('SENTINEL-NOVEL-TEXT'));
  });

  it('405 for GET on /v1/translate', async () => {
    const res = await fetch(`${srv.baseUrl}/v1/translate`);
    await expectError(res, 405, 'METHOD_NOT_ALLOWED');
    assert.equal(res.headers.get('allow'), 'POST');
  });

  it('request bodies are never written to logs', async () => {
    await postJson(srv.baseUrl, '/v1/translate', { ...VALID, text: 'LOGLEAK-SENTINEL' });
    assert.ok(srv.logs.length > 0);
    assert.ok(!srv.logs.join('\n').includes('LOGLEAK-SENTINEL'));
  });
});

describe('POST /v1/translate - not implemented in 05-B1', () => {
  let srv;
  before(async () => {
    srv = await startTestServer();
  });
  after(() => srv.close());

  it('valid request returns 501 NOT_IMPLEMENTED, never a fake success', async () => {
    const res = await postJson(srv.baseUrl, '/v1/translate', VALID);
    assert.equal(res.status, 501);
    const body = await res.json();
    assert.equal(body.error.code, 'NOT_IMPLEMENTED');
    assert.equal(body.translatedText, undefined);
  });
});

describe('provider port (seam only, test double)', () => {
  it('service delegates to an injected provider', async () => {
    const svc = createTranslateService({
      provider: { id: 'test-double', translate: async (r) => ({ ...r, translatedText: 'x', provider: 'test-double' }) },
    });
    assert.equal((await svc.translate(VALID)).provider, 'test-double');
  });

  it('rejects an object that does not satisfy the port', () => {
    assert.throws(() => createTranslateService({ provider: { id: 'bad' } }), TypeError);
  });

  it('with no provider, translate rejects with NOT_IMPLEMENTED', async () => {
    await assert.rejects(createTranslateService().translate(VALID), { code: 'NOT_IMPLEMENTED', status: 501 });
  });
});

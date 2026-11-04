import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import { startTestServer } from './helpers.js';

describe('GET /health', () => {
  let srv;
  before(async () => {
    srv = await startTestServer();
  });
  after(() => srv.close());

  it('returns 200 with the exact documented body', async () => {
    const res = await fetch(`${srv.baseUrl}/health`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^application\/json/);
    assert.deepEqual(await res.json(), {
      status: 'ok',
      service: 'mnb-translation-gateway',
      version: '0.1.0',
    });
  });

  it('version matches package.json', async () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const body = await (await fetch(`${srv.baseUrl}/health`)).json();
    assert.equal(body.version, pkg.version);
  });

  it('sets security headers and a request id', async () => {
    const res = await fetch(`${srv.baseUrl}/health`);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.match(res.headers.get('x-request-id'), /^[0-9a-f-]{36}$/);
  });

  it('rejects POST with 405 and an Allow header', async () => {
    const res = await fetch(`${srv.baseUrl}/health`, { method: 'POST' });
    assert.equal(res.status, 405);
    assert.equal(res.headers.get('allow'), 'GET');
    assert.equal((await res.json()).error.code, 'METHOD_NOT_ALLOWED');
  });

  it('returns 404 JSON for unknown routes', async () => {
    const res = await fetch(`${srv.baseUrl}/nope`);
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error.code, 'NOT_FOUND');
  });
});

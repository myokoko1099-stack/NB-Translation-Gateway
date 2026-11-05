import assert from 'node:assert/strict';
import http from 'node:http';
import { startTestServer } from './helpers.js';

/**
 * Phase 05-B2.3-T: shared helpers for the HTTP security tests.
 * Test-only file. It is not named *.test.js, so `node --test test/*.test.js`
 * does not run it directly.
 *
 * Why node:http instead of fetch()? The tests need full control over headers
 * that fetch() manages or forbids (Origin, Content-Type, Content-Length,
 * Transfer-Encoding) and over partially-sent bodies.
 */

export const TOKEN = 'b23t-http-security-test-token';
export const VALID = Object.freeze({ sourceLanguage: 'ja', targetLanguage: 'my', text: 'こんにちは' });
export const bearer = (token = TOKEN) => ({ authorization: `Bearer ${token}` });
export const UUID = /^[0-9a-f-]{36}$/;

/** Provider test double that counts calls (same shape as auth/rateLimit tests). */
export function countingProvider() {
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

/** Provider that throws a plain Error (exercises the 500 path). */
export function throwingProvider() {
  return {
    id: 'throwing-double',
    async translate() {
      throw new Error('boom (test double)');
    },
  };
}

/**
 * Send one raw HTTP request on its own keep-alive connection.
 *
 * Body options (use at most one):
 *   body   - string | Buffer, sent with req.end(body)
 *   chunks - string[], written one by one; without a Content-Length header
 *            Node uses Transfer-Encoding: chunked
 *   hold   - string, written but the request is NEVER finished (incomplete body)
 *
 * Resolves as soon as the response has been fully read. Socket errors that
 * happen after the response arrived (the server closes the connection after
 * 413 / 408) are ignored.
 *
 * @returns {Promise<{ status: number, headers: Record<string,string|string[]|undefined>,
 *                     rawHeaders: string[], text: string, json: () => any }>}
 */
export function rawRequest(baseUrl, { method = 'GET', path = '/', headers = {}, body, chunks, hold, timeoutMs = 8000 } = {}) {
  const url = new URL(baseUrl);
  // Keep-alive agent: the client then sends `Connection: keep-alive`, so a
  // `Connection: close` in the response really comes from the server.
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  return new Promise((resolve, reject) => {
    let settled = false;
    let req;
    const done = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(guard);
      fn(value);
      // Give the response a moment to flush, then drop the socket.
      setImmediate(() => {
        req?.destroy();
        agent.destroy();
      });
    };
    const guard = setTimeout(() => done(reject, new Error(`rawRequest timed out after ${timeoutMs} ms`)), timeoutMs);

    req = http.request({ host: url.hostname, port: url.port, method, path, headers, agent }, (res) => {
      const parts = [];
      const finish = () => {
        const text = Buffer.concat(parts).toString('utf8');
        done(resolve, {
          status: res.statusCode,
          headers: res.headers,
          rawHeaders: res.rawHeaders,
          text,
          json: () => JSON.parse(text),
        });
      };
      res.on('data', (c) => parts.push(c));
      res.on('end', finish);
      res.on('close', finish);
      res.on('error', finish);
    });
    req.on('error', (err) => done(reject, err));

    if (hold !== undefined) {
      req.write(hold);
    } else if (chunks !== undefined) {
      for (const c of chunks) req.write(c);
      req.end();
    } else if (body !== undefined) {
      req.end(body);
    } else {
      req.end();
    }
  });
}

/** POST /v1/translate with explicit control over every header. */
export function post(baseUrl, { headers = {}, ...rest } = {}) {
  return rawRequest(baseUrl, { method: 'POST', path: '/v1/translate', headers, ...rest });
}

/** POST a JSON object with a correct Content-Type (extra headers merged in). */
export function postJsonRaw(baseUrl, payload, headers = {}) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return post(baseUrl, {
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), ...headers },
    body,
  });
}

export function get(baseUrl, path = '/health', headers = {}) {
  return rawRequest(baseUrl, { method: 'GET', path, headers });
}

/** CORS preflight. `origin: null` omits the header; `requestHeaders: null` omits ACRH. */
export function preflight(
  baseUrl,
  { path = '/v1/translate', origin, method = 'POST', requestHeaders = 'authorization, content-type', extra = {} } = {},
) {
  const headers = { ...extra };
  if (origin !== null && origin !== undefined) headers.origin = origin;
  if (method !== null) headers['access-control-request-method'] = method;
  if (requestHeaders !== null) headers['access-control-request-headers'] = requestHeaders;
  return rawRequest(baseUrl, { method: 'OPTIONS', path, headers });
}

/** Run `fn` against a real server and always close it. */
export async function withServer(env, appOverrides, fn) {
  const srv = await startTestServer(env, appOverrides);
  try {
    return await fn(srv);
  } finally {
    await srv.close();
  }
}

/** Lower-cased tokens of the Vary header. */
export function varyTokens(res) {
  return String(res.headers.vary ?? '')
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

/** Number of times a header name appears in the raw response header list. */
export function headerCount(res, name) {
  let n = 0;
  for (let i = 0; i < res.rawHeaders.length; i += 2) {
    if (res.rawHeaders[i].toLowerCase() === name) n += 1;
  }
  return n;
}

export const SECURITY_HEADER_NAMES = Object.freeze([
  'x-content-type-options',
  'referrer-policy',
  'x-frame-options',
  'content-security-policy',
  'permissions-policy',
]);

/**
 * The five B2.3 security headers must be present, correct and sent exactly once.
 * Values are written out literally on purpose (not imported from src/), so a
 * silent change in the source is caught.
 */
export function assertSecurityHeaders(res, label = '') {
  const at = label ? ` [${label}]` : '';
  const h = res.headers;
  assert.equal(h['x-content-type-options'], 'nosniff', `X-Content-Type-Options${at}`);
  assert.equal(h['referrer-policy'], 'no-referrer', `Referrer-Policy${at}`);
  assert.equal(h['x-frame-options'], 'DENY', `X-Frame-Options${at}`);
  assert.equal(h['content-security-policy'], "default-src 'none'; frame-ancestors 'none'", `Content-Security-Policy${at}`);
  const pp = h['permissions-policy'];
  assert.equal(typeof pp, 'string', `Permissions-Policy present${at}`);
  for (const feature of ['camera=()', 'microphone=()', 'geolocation=()', 'payment=()']) {
    assert.ok(pp.includes(feature), `Permissions-Policy contains ${feature}${at}`);
  }
  for (const name of SECURITY_HEADER_NAMES) {
    assert.equal(headerCount(res, name), 1, `${name} sent exactly once${at}`);
  }
}

/** No CORS grant of any kind on the response. */
export function assertNoCorsGrant(res, label = '') {
  const at = label ? ` [${label}]` : '';
  for (const name of [
    'access-control-allow-origin',
    'access-control-allow-credentials',
    'access-control-allow-methods',
    'access-control-allow-headers',
    'access-control-expose-headers',
    'access-control-max-age',
  ]) {
    assert.equal(res.headers[name], undefined, `${name} must be absent${at}`);
  }
}

/** Assert an error response: status, machine code, request id, JSON content type. */
export function assertError(res, status, code) {
  assert.equal(res.status, status, `status (body: ${res.text.slice(0, 200)})`);
  assert.match(String(res.headers['content-type']), /^application\/json/);
  const body = res.json();
  assert.equal(body.error.code, code);
  assert.match(body.error.requestId, UUID);
  return body;
}

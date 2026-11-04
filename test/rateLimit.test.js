import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { loadConfig } from '../src/config/config.js';
import { ConfigError } from '../src/domain/errors.js';
import { ipToKey, resolveClientIp } from '../src/infrastructure/http/clientIp.js';
import { createRateLimiter } from '../src/infrastructure/http/rateLimiter.js';
import { postJson, startTestServer } from './helpers.js';

const TOKEN = 'rate-limit-test-client-token';
const VALID = { sourceLanguage: 'ja', targetLanguage: 'my', text: 'こんにちは' };
const auth = { authorization: `Bearer ${TOKEN}` };

function fakeClock(start = 0) {
  const clock = { t: start, now: () => clock.t, advance: (ms) => (clock.t += ms) };
  return clock;
}

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

/* ------------------------------------------------------------------ */
describe('rate limiter core (fake clock)', () => {
  it('1. requests within the limit are allowed and counted down', () => {
    const c = fakeClock();
    const rl = createRateLimiter({ max: 3, windowMs: 60_000, now: c.now });
    for (const remaining of [2, 1, 0]) {
      const d = rl.check('a');
      assert.equal(d.allowed, true);
      assert.equal(d.limit, 3);
      assert.equal(d.remaining, remaining);
      assert.equal(d.resetSeconds, 60);
    }
    rl.stop();
  });

  it('2. the request after the limit is denied; denied requests do not extend the block', () => {
    const c = fakeClock();
    const rl = createRateLimiter({ max: 2, windowMs: 60_000, now: c.now });
    rl.check('a');
    rl.check('a');
    for (let i = 0; i < 5; i += 1) {
      assert.equal(rl.check('a').allowed, false);
    }
    c.advance(60_000); // exactly the window end: counter restarts
    assert.equal(rl.check('a').allowed, true);
    rl.stop();
  });

  it('4. retryAfterSeconds is a positive integer that shrinks with time and is never 0', () => {
    const c = fakeClock();
    const rl = createRateLimiter({ max: 1, windowMs: 60_000, now: c.now });
    rl.check('a');
    assert.equal(rl.check('a').retryAfterSeconds, 60);
    c.advance(30_000);
    assert.equal(rl.check('a').retryAfterSeconds, 30);
    c.advance(29_500); // 500 ms left -> rounds UP to 1
    const d = rl.check('a');
    assert.equal(d.retryAfterSeconds, 1);
    assert.ok(Number.isInteger(d.retryAfterSeconds));
    rl.stop();
  });

  it('6. window expiration resets the counter', () => {
    const c = fakeClock();
    const rl = createRateLimiter({ max: 2, windowMs: 1000, now: c.now });
    rl.check('a');
    rl.check('a');
    assert.equal(rl.check('a').allowed, false);
    c.advance(1001);
    const d = rl.check('a');
    assert.equal(d.allowed, true);
    assert.equal(d.remaining, 1);
    rl.stop();
  });

  it('7. different keys have independent counters', () => {
    const c = fakeClock();
    const rl = createRateLimiter({ max: 1, windowMs: 60_000, now: c.now });
    assert.equal(rl.check('1.1.1.1').allowed, true);
    assert.equal(rl.check('1.1.1.1').allowed, false);
    assert.equal(rl.check('2.2.2.2').allowed, true);
    rl.stop();
  });

  it('9. cleanup: sweep removes expired records only', () => {
    const c = fakeClock();
    const rl = createRateLimiter({ max: 5, windowMs: 60_000, now: c.now });
    for (let i = 0; i < 100; i += 1) rl.check(`old-${i}`);
    c.advance(30_000);
    rl.check('young');
    assert.equal(rl.size(), 101);
    c.advance(30_001); // old-* expired, young still live
    assert.equal(rl.size(), 101, 'nothing is removed until a sweep runs');
    assert.equal(rl.sweep(), 100);
    assert.equal(rl.size(), 1);
    c.advance(60_000);
    assert.equal(rl.sweep(), 1);
    assert.equal(rl.size(), 0);
    rl.stop();
  });

  it('9. cleanup: records stay ordered by expiry after a window restart', () => {
    const c = fakeClock();
    const rl = createRateLimiter({ max: 5, windowMs: 60_000, now: c.now });
    rl.check('A'); // expires 60_000
    c.advance(10_000);
    rl.check('B'); // expires 70_000
    c.advance(55_000); // t = 65_000: A restarts -> expires 125_000
    rl.check('A');
    c.advance(6_000); // t = 71_000: B expired, A live
    assert.equal(rl.sweep(), 1);
    assert.equal(rl.size(), 1);
    rl.stop();
  });

  it('9. memory cap: a full store rejects NEW keys (fail closed), keeps live ones, recovers after expiry', () => {
    const c = fakeClock();
    const rl = createRateLimiter({ max: 5, windowMs: 60_000, maxKeys: 3, now: c.now });
    for (const k of ['a', 'b', 'c']) assert.equal(rl.check(k).allowed, true);
    const denied = rl.check('d');
    assert.equal(denied.allowed, false);
    assert.ok(denied.retryAfterSeconds >= 1);
    assert.equal(rl.size(), 3, 'store never grows past maxKeys');
    assert.equal(rl.check('a').allowed, true, 'existing clients are not evicted');
    c.advance(60_001);
    assert.equal(rl.check('d').allowed, true, 'expired records are swept on insert');
    assert.ok(rl.size() <= 3);
    rl.stop();
  });

  it('9. background sweep removes expired records by itself, and stop() halts it', async () => {
    const c = fakeClock();
    const rl = createRateLimiter({ max: 5, windowMs: 1000, sweepIntervalMs: 10, now: c.now });
    rl.check('x');
    assert.equal(rl.size(), 1);
    c.advance(2000);
    await sleep(80);
    assert.equal(rl.size(), 0);

    rl.check('y');
    rl.stop();
    c.advance(2000);
    await sleep(80);
    assert.equal(rl.size(), 1, 'no sweeping after stop()');
  });

  it('8. invalid limiter options throw a RangeError naming the option', () => {
    for (const bad of [
      { max: 0, windowMs: 1000 },
      { max: 1.5, windowMs: 1000 },
      { max: 5, windowMs: 0 },
      { max: 5, windowMs: Number.NaN },
      { max: 5, windowMs: 1000, maxKeys: -1 },
    ]) {
      assert.throws(() => createRateLimiter(bad), RangeError);
    }
  });
});

/* ------------------------------------------------------------------ */
describe('rate limit configuration', () => {
  it('has safe defaults (60 requests / 60 s, proxy headers not trusted)', () => {
    const c = loadConfig({});
    assert.deepEqual({ ...c.rateLimit }, { max: 60, windowMs: 60_000, trustedProxyHops: 0 });
  });

  it('reads GATEWAY_RATE_LIMIT_* and GATEWAY_TRUSTED_PROXY_HOPS; empty means default', () => {
    const c = loadConfig({
      GATEWAY_RATE_LIMIT_MAX: '5',
      GATEWAY_RATE_LIMIT_WINDOW_MS: '2000',
      GATEWAY_TRUSTED_PROXY_HOPS: '1',
    });
    assert.deepEqual({ ...c.rateLimit }, { max: 5, windowMs: 2000, trustedProxyHops: 1 });
    assert.equal(loadConfig({ GATEWAY_RATE_LIMIT_MAX: '' }).rateLimit.max, 60);
  });

  it('8. invalid values fail with a clear message naming the variable, never echoing the value', () => {
    const cases = [
      ['GATEWAY_RATE_LIMIT_MAX', '0'],
      ['GATEWAY_RATE_LIMIT_MAX', '-1'],
      ['GATEWAY_RATE_LIMIT_MAX', 'bad-value-xyz'],
      ['GATEWAY_RATE_LIMIT_MAX', '1.5'],
      ['GATEWAY_RATE_LIMIT_MAX', '100001'],
      ['GATEWAY_RATE_LIMIT_WINDOW_MS', '999'],
      ['GATEWAY_RATE_LIMIT_WINDOW_MS', '3600001'],
      ['GATEWAY_RATE_LIMIT_WINDOW_MS', 'bad-value-xyz'],
      ['GATEWAY_TRUSTED_PROXY_HOPS', '11'],
      ['GATEWAY_TRUSTED_PROXY_HOPS', '-1'],
      ['GATEWAY_TRUSTED_PROXY_HOPS', 'bad-value-xyz'],
    ];
    for (const [name, value] of cases) {
      assert.throws(
        () => loadConfig({ [name]: value }),
        (e) =>
          e instanceof ConfigError &&
          e.problems.some((p) => p.startsWith(name)) &&
          !e.message.includes('bad-value-xyz') &&
          !e.message.includes(`=${value}`),
        `${name}=${value}`,
      );
    }
  });

  it('8. reports every invalid rate-limit variable at once', () => {
    try {
      loadConfig({
        GATEWAY_RATE_LIMIT_MAX: '0',
        GATEWAY_RATE_LIMIT_WINDOW_MS: '1',
        GATEWAY_TRUSTED_PROXY_HOPS: '99',
      });
      assert.fail('expected ConfigError');
    } catch (e) {
      assert.ok(e instanceof ConfigError);
      assert.equal(e.problems.length, 3);
    }
  });

  it('8. startTestServer surfaces the configuration error', async () => {
    await assert.rejects(startTestServer({ GATEWAY_RATE_LIMIT_MAX: '0' }), ConfigError);
  });
});

/* ------------------------------------------------------------------ */
describe('client IP resolution', () => {
  const req = (remoteAddress, headers = {}) => ({ socket: { remoteAddress }, headers });

  it('uses the TCP peer address and ignores X-Forwarded-For when hops = 0', () => {
    assert.equal(resolveClientIp(req('10.0.0.5', { 'x-forwarded-for': '6.6.6.6' }), 0), '10.0.0.5');
  });

  it('normalises IPv4-mapped IPv6 and groups IPv6 by /64', () => {
    assert.equal(resolveClientIp(req('::ffff:10.0.0.5'), 0), '10.0.0.5');
    assert.equal(ipToKey('2001:db8:abcd:12:1:2:3:4'), ipToKey('2001:db8:abcd:12:ffff::9'));
    assert.notEqual(ipToKey('2001:db8:abcd:12::1'), ipToKey('2001:db8:abcd:13::1'));
    assert.equal(ipToKey('2001:db8::1'), '2001:db8:0:0::/64');
  });

  it('hops = 1 takes the LAST entry; client-supplied earlier entries are ignored', () => {
    const r = req('10.0.0.1', { 'x-forwarded-for': '6.6.6.6, 7.7.7.7, 203.0.113.9' });
    assert.equal(resolveClientIp(r, 1), '203.0.113.9');
  });

  it('hops = 2 takes the second entry from the right', () => {
    const r = req('10.0.0.1', { 'x-forwarded-for': '6.6.6.6, 203.0.113.9, 10.9.9.9' });
    assert.equal(resolveClientIp(r, 2), '203.0.113.9');
  });

  it('falls back to the peer address for a missing, short or invalid header', () => {
    assert.equal(resolveClientIp(req('10.0.0.1'), 1), '10.0.0.1');
    assert.equal(resolveClientIp(req('10.0.0.1', { 'x-forwarded-for': '1.1.1.1' }), 2), '10.0.0.1');
    assert.equal(resolveClientIp(req('10.0.0.1', { 'x-forwarded-for': 'not-an-ip' }), 1), '10.0.0.1');
    assert.equal(resolveClientIp(req('10.0.0.1', { 'x-forwarded-for': '1.1.1.1:8080' }), 1), '10.0.0.1');
    assert.equal(resolveClientIp(req('10.0.0.1', { 'x-forwarded-for': '1.1.1.1,' }), 1), '10.0.0.1');
  });

  it('uses one shared "unknown" key when no address is available', () => {
    assert.equal(resolveClientIp({ socket: {}, headers: {} }, 0), 'unknown');
  });
});

/* ------------------------------------------------------------------ */
describe('POST /v1/translate - rate limiting over HTTP', () => {
  async function withServer(env, appOverrides, fn) {
    const srv = await startTestServer(env, appOverrides);
    try {
      await fn(srv);
    } finally {
      await srv.close();
    }
  }
  const cfg = (extra = {}) => ({ GATEWAY_CLIENT_TOKEN: TOKEN, GATEWAY_RATE_LIMIT_MAX: '3', ...extra });

  it('1+5. requests within the limit succeed and carry rate limit headers', async () => {
    const provider = countingProvider();
    await withServer(cfg(), { provider }, async (srv) => {
      for (const remaining of ['2', '1', '0']) {
        const res = await postJson(srv.baseUrl, '/v1/translate', VALID, auth);
        assert.equal(res.status, 200);
        assert.equal(res.headers.get('ratelimit-limit'), '3');
        assert.equal(res.headers.get('ratelimit-remaining'), remaining);
        assert.match(res.headers.get('ratelimit-reset'), /^[1-9]\d*$/);
        assert.equal(res.headers.get('retry-after'), null);
        await res.text();
      }
      assert.equal(provider.calls, 3);
    });
  });

  it('2+3+4+5+10. over the limit: 429, Retry-After, headers, secret-free body, provider NOT called', async () => {
    const provider = countingProvider();
    await withServer(cfg(), { provider }, async (srv) => {
      for (let i = 0; i < 3; i += 1) {
        await (await postJson(srv.baseUrl, '/v1/translate', VALID, auth)).text();
      }
      const res = await postJson(srv.baseUrl, '/v1/translate', VALID, auth);
      assert.equal(res.status, 429);
      const text = await res.text();
      const body = JSON.parse(text);
      assert.equal(body.error.code, 'RATE_LIMITED');
      assert.equal(body.error.message, 'Too many requests.');
      assert.match(body.error.requestId, /^[0-9a-f-]{36}$/);
      const retry = res.headers.get('retry-after');
      assert.match(retry, /^[1-9]\d*$/);
      assert.ok(Number(retry) <= 60);
      assert.equal(res.headers.get('ratelimit-limit'), '3');
      assert.equal(res.headers.get('ratelimit-remaining'), '0');
      assert.ok(res.headers.get('ratelimit-reset'));
      assert.ok(!text.includes(TOKEN));
      assert.equal(provider.calls, 3, 'provider must not be called for the limited request');
    });
  });

  it('10. the limit is enforced before body parsing and validation', async () => {
    const provider = countingProvider();
    await withServer(cfg({ GATEWAY_RATE_LIMIT_MAX: '1' }), { provider }, async (srv) => {
      await (await postJson(srv.baseUrl, '/v1/translate', VALID, auth)).text();
      for (const body of ['{not json', {}, VALID]) {
        const res = await postJson(srv.baseUrl, '/v1/translate', body, auth);
        assert.equal(res.status, 429);
        await res.text();
      }
      assert.equal(provider.calls, 1);
    });
  });

  it('6. window expiration lets the client through again (fake clock)', async () => {
    const c = fakeClock();
    const rateLimiter = createRateLimiter({ max: 2, windowMs: 60_000, now: c.now });
    const provider = countingProvider();
    await withServer({ GATEWAY_CLIENT_TOKEN: TOKEN }, { provider, rateLimiter }, async (srv) => {
      for (let i = 0; i < 2; i += 1) await (await postJson(srv.baseUrl, '/v1/translate', VALID, auth)).text();
      const limited = await postJson(srv.baseUrl, '/v1/translate', VALID, auth);
      assert.equal(limited.status, 429);
      await limited.text();
      c.advance(60_001);
      const again = await postJson(srv.baseUrl, '/v1/translate', VALID, auth);
      assert.equal(again.status, 200);
      assert.equal(again.headers.get('ratelimit-remaining'), '1');
      await again.text();
      assert.equal(provider.calls, 3);
    });
  });

  it('7. different client IPs have separate budgets (trusted proxy hops = 1)', async () => {
    const provider = countingProvider();
    await withServer(cfg({ GATEWAY_RATE_LIMIT_MAX: '2', GATEWAY_TRUSTED_PROXY_HOPS: '1' }), { provider }, async (srv) => {
      const send = (xff) => postJson(srv.baseUrl, '/v1/translate', VALID, { ...auth, 'x-forwarded-for': xff });
      for (let i = 0; i < 2; i += 1) assert.equal((await send('203.0.113.1')).status, 200);
      assert.equal((await send('203.0.113.1')).status, 429);
      assert.equal((await send('203.0.113.2')).status, 200, 'another client is unaffected');
      // Spoofed leading entries cannot create a fresh identity.
      assert.equal((await send('9.9.9.9, 203.0.113.1')).status, 429);
      assert.equal((await send('8.8.8.8, 203.0.113.1')).status, 429);
    });
  });

  it('3. X-Forwarded-For is NOT trusted by default (spoofing cannot evade the limit)', async () => {
    await withServer(cfg({ GATEWAY_RATE_LIMIT_MAX: '2' }), {}, async (srv) => {
      const send = (xff) => postJson(srv.baseUrl, '/v1/translate', VALID, { ...auth, 'x-forwarded-for': xff });
      assert.equal((await send('1.1.1.1')).status, 501);
      assert.equal((await send('2.2.2.2')).status, 501);
      assert.equal((await send('3.3.3.3')).status, 429);
    });
  });

  it('3. unauthenticated requests never create or consume limiter records', async () => {
    const rateLimiter = createRateLimiter({ max: 2, windowMs: 60_000 });
    await withServer(cfg({ GATEWAY_TRUSTED_PROXY_HOPS: '1' }), { rateLimiter }, async (srv) => {
      for (let i = 0; i < 30; i += 1) {
        const headers = { 'x-forwarded-for': `198.51.100.${i}` };
        const bad = i % 2 ? { ...headers, authorization: 'Bearer wrong-token' } : headers;
        const res = await postJson(srv.baseUrl, '/v1/translate', VALID, bad);
        assert.equal(res.status, 401);
        await res.text();
      }
      assert.equal(rateLimiter.size(), 0, 'limiter memory must not grow from unauthenticated traffic');
      await (await postJson(srv.baseUrl, '/v1/translate', VALID, { ...auth, 'x-forwarded-for': '198.51.100.99' })).text();
      assert.equal(rateLimiter.size(), 1);
    });
  });

  it('11. authentication still works: failures stay 401 (not 429) and do not use up the budget', async () => {
    const provider = countingProvider();
    await withServer(cfg({ GATEWAY_RATE_LIMIT_MAX: '2' }), { provider }, async (srv) => {
      for (let i = 0; i < 6; i += 1) {
        const res = await postJson(srv.baseUrl, '/v1/translate', VALID, { authorization: 'Bearer wrong-token' });
        assert.equal(res.status, 401);
        await res.text();
      }
      assert.equal((await postJson(srv.baseUrl, '/v1/translate', VALID)).status, 401);
      assert.equal((await postJson(srv.baseUrl, '/v1/translate', VALID, auth)).status, 200);
      assert.equal((await postJson(srv.baseUrl, '/v1/translate', VALID, auth)).status, 200);
      assert.equal((await postJson(srv.baseUrl, '/v1/translate', VALID, auth)).status, 429);
      // Even once rate limited, a wrong token is still reported as 401.
      assert.equal((await postJson(srv.baseUrl, '/v1/translate', VALID, { authorization: 'Bearer nope' })).status, 401);
      assert.equal(provider.calls, 2);
    });
  });

  it('GET /health is not rate limited and is unchanged', async () => {
    await withServer(cfg({ GATEWAY_RATE_LIMIT_MAX: '1' }), {}, async (srv) => {
      for (let i = 0; i < 10; i += 1) {
        const res = await fetch(`${srv.baseUrl}/health`);
        assert.equal(res.status, 200);
        assert.equal(res.headers.get('ratelimit-limit'), null);
        assert.deepEqual(await res.json(), { status: 'ok', service: 'mnb-translation-gateway', version: '0.1.0' });
      }
    });
  });

  it('rate limiting also applies when authentication is not configured (dev/test)', async () => {
    await withServer({ GATEWAY_RATE_LIMIT_MAX: '2' }, {}, async (srv) => {
      assert.equal((await postJson(srv.baseUrl, '/v1/translate', VALID)).status, 501);
      assert.equal((await postJson(srv.baseUrl, '/v1/translate', VALID)).status, 501);
      assert.equal((await postJson(srv.baseUrl, '/v1/translate', VALID)).status, 429);
    });
  });

  it('logs never contain the token or a client address; the rejection is logged', async () => {
    await withServer(cfg({ GATEWAY_RATE_LIMIT_MAX: '1' }), {}, async (srv) => {
      await (await postJson(srv.baseUrl, '/v1/translate', VALID, auth)).text();
      await (await postJson(srv.baseUrl, '/v1/translate', VALID, auth)).text();
      const logs = srv.logs.join('\n');
      assert.ok(logs.includes('rate limit exceeded'));
      assert.ok(!logs.includes(TOKEN));
      assert.ok(!logs.includes('127.0.0.1'));
    });
  });

  it('9. the limiter timer is stopped when the server closes', async () => {
    const rateLimiter = createRateLimiter({ max: 2, windowMs: 60_000 });
    let stopped = 0;
    const original = rateLimiter.stop;
    rateLimiter.stop = () => {
      stopped += 1;
      original();
    };
    await withServer({}, { rateLimiter }, async () => {});
    assert.equal(stopped, 1);
  });
});

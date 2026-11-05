import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ConfigError } from '../src/domain/errors.js';
import { Secret } from '../src/config/secrets.js';
import {
  MIN_CLIENT_TOKEN_LENGTH,
  assertProductionConfig,
  collectProductionProblems,
} from '../src/config/productionGuard.js';

/**
 * Phase 05-B4: Production Guard activation.
 *
 * Part 1 - the guard's rules (pure functions, no I/O).
 * Part 2 - the real startup path: src/index.js is run as a child process, the
 *          same way test/geminiConfig.test.js does it. No network call is made
 *          (the translation provider stays "none"), and no real secret is used.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const GOOD_TOKEN = 'startup-test-token-0123456789';
const PROD = Object.freeze({ env: 'production', logLevel: 'info' });
const auth = (value) => ({ enabled: true, token: new Secret(value) });

/* ------------------------------------------------------------------ */
describe('B4 guard rules - client token', () => {
  it('exports a minimum token length of 16', () => {
    assert.equal(MIN_CLIENT_TOKEN_LENGTH, 16);
  });

  it('accepts a token of exactly the minimum length', () => {
    assert.deepEqual(collectProductionProblems(PROD, auth('a1b2c3d4e5f6g7h8')), []);
  });

  it('rejects a token one character short, naming only the variable and the limit', () => {
    const problems = collectProductionProblems(PROD, auth('a1b2c3d4e5f6g7h'));
    assert.deepEqual(problems, ['GATEWAY_CLIENT_TOKEN must be at least 16 characters']);
  });

  it('rejects a single repeated character, even when long enough', () => {
    for (const bad of ['a'.repeat(32), '0'.repeat(16), 'Z'.repeat(64)]) {
      assert.deepEqual(collectProductionProblems(PROD, auth(bad)), [
        'GATEWAY_CLIENT_TOKEN must not be a single repeated character',
      ]);
    }
  });

  it('rejects placeholder values in any letter case', () => {
    for (const bad of [
      'changeme',
      'CHANGEME',
      'Change-Me',
      'your_token',
      'YOUR-TOKEN-HERE',
      'password',
      'xxxx',
      '<set-in-hosting-dashboard>',
      '<your-local-token>',
      '${GATEWAY_CLIENT_TOKEN}',
    ]) {
      assert.deepEqual(
        collectProductionProblems(PROD, auth(bad)),
        ['GATEWAY_CLIENT_TOKEN must not be a placeholder value'],
        `expected a placeholder problem for ${JSON.stringify(bad)}`,
      );
    }
  });

  it('reports a placeholder once (not also as "too short")', () => {
    assert.equal(collectProductionProblems(PROD, auth('changeme')).length, 1);
  });

  it('rejects missing authentication in every shape the auth config can take', () => {
    for (const missing of [undefined, null, { enabled: false, token: null }, { enabled: true, token: null }]) {
      assert.deepEqual(collectProductionProblems(PROD, missing), ['GATEWAY_CLIENT_TOKEN is required']);
    }
  });

  it('never puts the token (or any part of it) into a problem message', () => {
    const sentinels = ['SHORT-SENTINEL1', 'changeme', '<hidden-sentinel-value>', 'Q'.repeat(20)];
    for (const value of sentinels) {
      const text = JSON.stringify(collectProductionProblems({ ...PROD, logLevel: 'debug' }, auth(value)));
      assert.ok(!text.includes(value), `problem text leaked ${value}`);
    }
  });
});

/* ------------------------------------------------------------------ */
describe('B4 guard rules - LOG_LEVEL', () => {
  it('rejects debug in production', () => {
    assert.deepEqual(collectProductionProblems({ ...PROD, logLevel: 'debug' }, auth(GOOD_TOKEN)), [
      'LOG_LEVEL must not be "debug" in production',
    ]);
  });

  it('accepts every other valid level in production', () => {
    for (const logLevel of ['silent', 'error', 'warn', 'info']) {
      assert.deepEqual(collectProductionProblems({ ...PROD, logLevel }, auth(GOOD_TOKEN)), []);
    }
  });
});

/* ------------------------------------------------------------------ */
describe('B4 guard rules - aggregation and environments', () => {
  it('reports every problem at once', () => {
    const problems = collectProductionProblems({ ...PROD, logLevel: 'debug' }, auth('changeme'));
    assert.deepEqual(problems, [
      'GATEWAY_CLIENT_TOKEN must not be a placeholder value',
      'LOG_LEVEL must not be "debug" in production',
    ]);
  });

  it('assertProductionConfig throws a ConfigError carrying the same problems', () => {
    try {
      assertProductionConfig({ ...PROD, logLevel: 'debug' }, auth('changeme'));
      assert.fail('expected a ConfigError');
    } catch (err) {
      assert.ok(err instanceof ConfigError);
      assert.equal(err.problems.length, 2);
      assert.ok(!err.message.includes('changeme'));
    }
  });

  it('assertProductionConfig does not throw for an acceptable production configuration', () => {
    assert.doesNotThrow(() => assertProductionConfig(PROD, auth(GOOD_TOKEN)));
  });

  it('development and test are never checked, whatever the token or log level', () => {
    for (const env of ['development', 'test']) {
      for (const candidate of [undefined, { enabled: false, token: null }, auth('changeme'), auth('x'), auth('a'.repeat(20))]) {
        assert.deepEqual(collectProductionProblems({ env, logLevel: 'debug' }, candidate), []);
        assert.doesNotThrow(() => assertProductionConfig({ env, logLevel: 'debug' }, candidate));
      }
    }
  });
});

/* ------------------------------------------------------------------ */
// Startup path (src/index.js as a child process)

/** Run src/index.js to completion; only for runs that are expected to exit by themselves. */
function runToExit(env) {
  return spawnSync(process.execPath, ['src/index.js'], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, ...env },
    encoding: 'utf8',
    timeout: 15_000,
  });
}

/** Start src/index.js, wait for the "server started" log line, stop it with SIGTERM. */
function runUntilListening(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['src/index.js'], {
      cwd: ROOT,
      env: { PATH: process.env.PATH, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timer;
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(reject, new Error(`server did not start in time. stdout: ${stdout} stderr: ${stderr}`));
    }, 15_000);
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.includes('server started')) child.kill('SIGTERM');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (err) => finish(reject, err));
    child.on('close', (code) => finish(resolve, { code, stdout, stderr }));
  });
}

const PROD_ENV = { NODE_ENV: 'production', PORT: '0' };

function assertRefused(result, { present = [], absent = [] }) {
  assert.equal(result.status, 1, `expected exit 1; stderr: ${result.stderr}`);
  assert.match(result.stderr, /^Invalid configuration:/);
  for (const pattern of present) assert.match(result.stderr, pattern);
  const everything = `${result.stdout}\n${result.stderr}`;
  for (const secret of absent) {
    assert.ok(!everything.includes(secret), 'a secret value appeared in the startup output');
  }
  assert.ok(!result.stdout.includes('server started'), 'the server must not start');
}

describe('B4 startup - production (src/index.js as a child process)', () => {
  it('a placeholder client token exits 1 and is not printed', () => {
    const token = '<set-in-hosting-dashboard>';
    const result = runToExit({ ...PROD_ENV, GATEWAY_CLIENT_TOKEN: token });
    assertRefused(result, {
      present: [/GATEWAY_CLIENT_TOKEN must not be a placeholder value/],
      absent: [token, 'set-in-hosting-dashboard'],
    });
  });

  it('a too-short client token exits 1 and is not printed', () => {
    const token = 'SHORT-SENTINEL1';
    const result = runToExit({ ...PROD_ENV, GATEWAY_CLIENT_TOKEN: token });
    assertRefused(result, {
      present: [/GATEWAY_CLIENT_TOKEN must be at least 16 characters/],
      absent: [token],
    });
  });

  it('a single-repeated-character client token exits 1', () => {
    const token = 'k'.repeat(24);
    const result = runToExit({ ...PROD_ENV, GATEWAY_CLIENT_TOKEN: token });
    assertRefused(result, {
      present: [/GATEWAY_CLIENT_TOKEN must not be a single repeated character/],
      absent: [token],
    });
  });

  it('LOG_LEVEL=debug exits 1 even with a good token, and the token is not printed', () => {
    const result = runToExit({ ...PROD_ENV, GATEWAY_CLIENT_TOKEN: GOOD_TOKEN, LOG_LEVEL: 'debug' });
    assertRefused(result, {
      present: [/LOG_LEVEL must not be "debug" in production/],
      absent: [GOOD_TOKEN],
    });
  });

  it('every guard problem is reported in one run', () => {
    const token = 'changeme';
    const result = runToExit({ ...PROD_ENV, GATEWAY_CLIENT_TOKEN: token, LOG_LEVEL: 'debug' });
    assertRefused(result, {
      present: [/must not be a placeholder value/, /LOG_LEVEL must not be "debug"/],
      absent: [token],
    });
  });

  it('a missing client token still exits 1 (B2.1 behaviour is unchanged)', () => {
    const result = runToExit({ ...PROD_ENV });
    assertRefused(result, { present: [/GATEWAY_CLIENT_TOKEN is required/] });
  });

  it('a good token with a non-debug level is not refused by the guard', async () => {
    const result = await runUntilListening({ ...PROD_ENV, GATEWAY_CLIENT_TOKEN: GOOD_TOKEN, LOG_LEVEL: 'info' });
    assert.equal(result.code, 0, `stderr: ${result.stderr}`);
    assert.match(result.stdout, /server started/);
    assert.ok(!/Invalid configuration/.test(result.stderr), `stderr: ${result.stderr}`);
    assert.ok(!result.stdout.includes(GOOD_TOKEN), 'the client token must not appear in the log');
  });

  it('production without LOG_LEVEL uses the safe default (info) and starts', async () => {
    const result = await runUntilListening({ ...PROD_ENV, GATEWAY_CLIENT_TOKEN: GOOD_TOKEN });
    assert.equal(result.code, 0, `stderr: ${result.stderr}`);
    assert.match(result.stdout, /"authEnabled":true/);
  });
});

describe('B4 startup - development and test keep working', () => {
  it('test environment with a placeholder token and debug logging starts normally', async () => {
    const result = await runUntilListening({
      NODE_ENV: 'test',
      GATEWAY_CLIENT_TOKEN: 'changeme',
      LOG_LEVEL: 'debug',
    });
    assert.equal(result.code, 0, `stderr: ${result.stderr}`);
    assert.match(result.stdout, /server started/);
    assert.ok(!/Invalid configuration/.test(result.stderr), `stderr: ${result.stderr}`);
    assert.ok(!result.stdout.includes('changeme'), 'the token must not appear in the log');
  });

  it('development with no token and debug logging starts normally (auth not enforced)', async () => {
    const result = await runUntilListening({ NODE_ENV: 'development', PORT: '0' });
    assert.equal(result.code, 0, `stderr: ${result.stderr}`);
    assert.match(result.stdout, /client authentication is NOT enforced/);
    assert.match(result.stdout, /server started/);
  });
});

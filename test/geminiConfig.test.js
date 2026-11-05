import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { inspect } from 'node:util';
import { createTranslateService } from '../src/application/translateService.js';
import { EnvSecretProvider, Secret } from '../src/config/secrets.js';
import {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GEMINI_TIMEOUT_MS,
  loadTranslationProviderConfig,
} from '../src/config/translationProvider.js';
import { ConfigError } from '../src/domain/errors.js';
import { createProvider } from '../src/infrastructure/providers/createProvider.js';
import { GEMINI_ENDPOINT, GeminiProvider } from '../src/infrastructure/providers/geminiProvider.js';
import { assertTranslationProvider } from '../src/ports/translationProvider.js';

/**
 * Phase 05-B3 (1/3): configuration, provider selection, model selection.
 * Mock fetch only - the real Gemini API is never called and no real key is used.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const KEY = 'unit-test-gemini-key-0123456789';
const REQUEST = Object.freeze({ sourceLanguage: 'ja', targetLanguage: 'my', text: 'こんにちは' });

const load = (env) => loadTranslationProviderConfig(env, new EnvSecretProvider(env));

function problemsOf(env) {
  try {
    load(env);
  } catch (err) {
    assert.ok(err instanceof ConfigError, 'expected a ConfigError');
    return err;
  }
  return assert.fail('expected a ConfigError');
}

/** Fetch double that records calls and answers with a completed interaction. */
function recordingFetch() {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return new Response(
      JSON.stringify({ status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: 'ok' }] }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  fn.calls = calls;
  return fn;
}

describe('B3 configuration - TRANSLATION_PROVIDER=none', () => {
  it('is the default when the variable is unset, empty or blank', () => {
    for (const env of [{}, { TRANSLATION_PROVIDER: '' }, { TRANSLATION_PROVIDER: '   ' }]) {
      const cfg = load(env);
      assert.equal(cfg.provider, 'none');
      assert.equal(cfg.gemini, null);
    }
  });

  it('explicit "none" does not read or validate any Gemini variable', () => {
    const cfg = load({
      TRANSLATION_PROVIDER: 'none',
      GEMINI_API_KEY: 'bad key with spaces',
      GEMINI_MODEL: 'not a valid model!',
      GEMINI_TIMEOUT_MS: 'abc',
    });
    assert.equal(cfg.provider, 'none');
    assert.equal(cfg.gemini, null);
  });

  it('the configuration object is frozen', () => {
    assert.ok(Object.isFrozen(load({})));
  });
});

describe('B3 configuration - TRANSLATION_PROVIDER=gemini', () => {
  it('requires GEMINI_API_KEY and names only the variable', () => {
    const err = problemsOf({ TRANSLATION_PROVIDER: 'gemini' });
    assert.deepEqual(err.problems, ['GEMINI_API_KEY is required when TRANSLATION_PROVIDER=gemini']);
    const blank = problemsOf({ TRANSLATION_PROVIDER: 'gemini', GEMINI_API_KEY: '' });
    assert.equal(blank.problems.length, 1);
  });

  it('loads the key as a Secret wrapper that never serialises', () => {
    const cfg = load({ TRANSLATION_PROVIDER: 'gemini', GEMINI_API_KEY: KEY });
    assert.equal(cfg.provider, 'gemini');
    assert.ok(cfg.gemini.apiKey instanceof Secret);
    assert.equal(cfg.gemini.apiKey.reveal(), KEY);
    assert.equal(String(cfg.gemini.apiKey), '[REDACTED]');
    assert.ok(!JSON.stringify(cfg).includes(KEY));
    assert.ok(!inspect(cfg, { depth: 5 }).includes(KEY));
    assert.ok(Object.isFrozen(cfg));
    assert.ok(Object.isFrozen(cfg.gemini));
  });

  it('uses the default model and timeout', () => {
    const cfg = load({ TRANSLATION_PROVIDER: 'gemini', GEMINI_API_KEY: KEY });
    assert.equal(cfg.gemini.model, 'gemini-3.1-flash-lite');
    assert.equal(cfg.gemini.model, DEFAULT_GEMINI_MODEL);
    assert.equal(cfg.gemini.timeoutMs, 30000);
    assert.equal(cfg.gemini.timeoutMs, DEFAULT_GEMINI_TIMEOUT_MS);
  });

  it('accepts a custom model and timeout; blank values mean "default"', () => {
    const cfg = load({
      TRANSLATION_PROVIDER: 'gemini',
      GEMINI_API_KEY: KEY,
      GEMINI_MODEL: 'custom-model-7.2',
      GEMINI_TIMEOUT_MS: '5000',
    });
    assert.equal(cfg.gemini.model, 'custom-model-7.2');
    assert.equal(cfg.gemini.timeoutMs, 5000);
    const blank = load({ TRANSLATION_PROVIDER: 'gemini', GEMINI_API_KEY: KEY, GEMINI_MODEL: '', GEMINI_TIMEOUT_MS: '' });
    assert.equal(blank.gemini.model, DEFAULT_GEMINI_MODEL);
    assert.equal(blank.gemini.timeoutMs, DEFAULT_GEMINI_TIMEOUT_MS);
  });

  it('provider name is trimmed and case-insensitive', () => {
    assert.equal(load({ TRANSLATION_PROVIDER: ' Gemini ', GEMINI_API_KEY: KEY }).provider, 'gemini');
    assert.equal(load({ TRANSLATION_PROVIDER: 'NONE' }).provider, 'none');
  });

  it('rejects invalid timeouts', () => {
    for (const GEMINI_TIMEOUT_MS of ['abc', '-5', '1.5', '999', '120001', '1e4', '30 000']) {
      const err = problemsOf({ TRANSLATION_PROVIDER: 'gemini', GEMINI_API_KEY: KEY, GEMINI_TIMEOUT_MS });
      assert.deepEqual(err.problems, ['GEMINI_TIMEOUT_MS must be an integer between 1000 and 120000']);
    }
  });

  it('rejects invalid model ids (no path, space or injection characters)', () => {
    for (const GEMINI_MODEL of ['bad model', '../models/x', 'a/b', 'm?x=1', 'm\nx', '-leading-dash', 'x'.repeat(65)]) {
      const err = problemsOf({ TRANSLATION_PROVIDER: 'gemini', GEMINI_API_KEY: KEY, GEMINI_MODEL });
      assert.equal(err.problems.length, 1);
      assert.match(err.problems[0], /^GEMINI_MODEL must be a model id/);
    }
  });

  it('rejects a key with whitespace / control characters and never echoes it', () => {
    for (const bad of ['has space-SECRETPART', 'tab\tSECRETPART', 'new\nSECRETPART', 'x'.repeat(513)]) {
      const err = problemsOf({ TRANSLATION_PROVIDER: 'gemini', GEMINI_API_KEY: bad });
      assert.match(err.problems[0], /^GEMINI_API_KEY must be non-empty printable ASCII/);
      assert.ok(!err.message.includes('SECRETPART'));
    }
  });

  it('reports every problem at once', () => {
    const err = problemsOf({ TRANSLATION_PROVIDER: 'gemini', GEMINI_MODEL: 'bad model', GEMINI_TIMEOUT_MS: 'abc' });
    assert.equal(err.problems.length, 3);
  });

  it('an unknown provider is rejected without echoing the value', () => {
    const err = problemsOf({ TRANSLATION_PROVIDER: 'sentinel-provider-xyz' });
    assert.deepEqual(err.problems, ['TRANSLATION_PROVIDER must be one of: none, gemini']);
    assert.ok(!err.message.includes('sentinel-provider-xyz'));
  });
});

describe('B3 startup (src/index.js)', () => {
  it('TRANSLATION_PROVIDER=gemini without a key exits 1 naming only the variable', () => {
    const result = spawnSync(process.execPath, ['src/index.js'], {
      cwd: ROOT,
      env: { PATH: process.env.PATH, NODE_ENV: 'test', TRANSLATION_PROVIDER: 'gemini' },
      encoding: 'utf8',
      timeout: 15_000,
    });
    assert.equal(result.status, 1, `stderr: ${result.stderr}`);
    assert.match(result.stderr, /GEMINI_API_KEY is required when TRANSLATION_PROVIDER=gemini/);
  });

  it('an unknown TRANSLATION_PROVIDER exits 1', () => {
    const result = spawnSync(process.execPath, ['src/index.js'], {
      cwd: ROOT,
      env: { PATH: process.env.PATH, NODE_ENV: 'test', TRANSLATION_PROVIDER: 'openai' },
      encoding: 'utf8',
      timeout: 15_000,
    });
    assert.equal(result.status, 1, `stderr: ${result.stderr}`);
    assert.match(result.stderr, /TRANSLATION_PROVIDER must be one of: none, gemini/);
  });
});

describe('B3 provider selection (createProvider)', () => {
  it('"none" -> null, and the service keeps answering 501 NOT_IMPLEMENTED', async () => {
    const provider = createProvider(load({}));
    assert.equal(provider, null);
    const service = createTranslateService({ provider });
    await assert.rejects(service.translate(REQUEST), { status: 501, code: 'NOT_IMPLEMENTED' });
  });

  it('"gemini" -> a GeminiProvider that satisfies the provider port', () => {
    const provider = createProvider(load({ TRANSLATION_PROVIDER: 'gemini', GEMINI_API_KEY: KEY }), {
      fetchImpl: recordingFetch(),
    });
    assert.ok(provider instanceof GeminiProvider);
    assert.equal(provider.id, 'gemini');
    assert.doesNotThrow(() => assertTranslationProvider(provider));
  });

  it('an unknown / malformed configuration is rejected', () => {
    assert.throws(() => createProvider({ provider: 'openai', gemini: null }), ConfigError);
    assert.throws(() => createProvider(undefined), ConfigError);
    assert.throws(() => createProvider(null), ConfigError);
  });

  it('the provider never exposes the key through JSON, String or inspect', () => {
    const provider = createProvider(load({ TRANSLATION_PROVIDER: 'gemini', GEMINI_API_KEY: KEY }), {
      fetchImpl: recordingFetch(),
    });
    assert.ok(!JSON.stringify(provider).includes(KEY));
    assert.ok(!String(provider).includes(KEY));
    assert.ok(!inspect(provider, { depth: 5 }).includes(KEY));
  });
});

describe('B3 model selection', () => {
  async function sentBody(env) {
    const fetchImpl = recordingFetch();
    const provider = createProvider(load({ TRANSLATION_PROVIDER: 'gemini', GEMINI_API_KEY: KEY, ...env }), { fetchImpl });
    await provider.translate(REQUEST);
    assert.equal(fetchImpl.calls.length, 1);
    assert.equal(fetchImpl.calls[0].url, GEMINI_ENDPOINT);
    return JSON.parse(fetchImpl.calls[0].init.body);
  }

  it('sends the default model when GEMINI_MODEL is unset', async () => {
    assert.equal((await sentBody({})).model, 'gemini-3.1-flash-lite');
  });

  it('sends the configured GEMINI_MODEL', async () => {
    assert.equal((await sentBody({ GEMINI_MODEL: 'custom-model-7.2' })).model, 'custom-model-7.2');
  });
});

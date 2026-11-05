import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { startTestServer } from './helpers.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKIP_DIRS = new Set(['node_modules', '.git']);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

// A *_API_KEY assignment that carries a value. Phase 05-B3: horizontal
// whitespace only ([ \t], not \s) so an EMPTY placeholder such as `GEMINI_API_KEY=`
// is not "completed" by the first character of the NEXT line (false positive),
// and an inline comment or an empty quoted value counts as empty.
const NON_EMPTY_API_KEY_ASSIGNMENT = /^[ \t]*(?:export[ \t]+)?[A-Z0-9_]*API_KEY[ \t]*=[ \t]*(?!#|""[ \t]*$|''[ \t]*$)\S/m;

// Patterns that indicate a real credential committed to the tree.
const SECRET_PATTERNS = [
  { name: 'Google API key', re: /AIza[0-9A-Za-z_-]{35}/ },
  { name: 'private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'GitHub token', re: /gh[pousr]_[A-Za-z0-9]{36,}/ },
  { name: 'Anthropic/OpenAI-style key', re: /sk-[A-Za-z0-9_-]{20,}/ },
  { name: 'AWS access key id', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'non-empty *_API_KEY assignment', re: NON_EMPTY_API_KEY_ASSIGNMENT },
];

describe('secret exposure check', () => {
  const files = walk(ROOT).filter((f) => !/\.(png|jpg|zip)$/i.test(f));

  it('scans a non-trivial set of files', () => {
    assert.ok(files.length >= 15, `only ${files.length} files scanned`);
  });

  for (const { name, re } of SECRET_PATTERNS) {
    it(`no ${name} in any project file`, () => {
      const hits = files.filter((f) => re.test(readFileSync(f, 'utf8'))).map((f) => relative(ROOT, f));
      assert.deepEqual(hits, []);
    });
  }

  it('the *_API_KEY pattern ignores an empty placeholder but still catches a real value', () => {
    const re = NON_EMPTY_API_KEY_ASSIGNMENT;
    // Empty placeholders (also when more lines follow) are fine.
    assert.equal(re.test('GEMINI_API_KEY=\n# next line is a comment\nOTHER=1\n'), false);
    assert.equal(re.test('GEMINI_API_KEY=\n\nGEMINI_MODEL=x\n'), false);
    assert.equal(re.test('GEMINI_API_KEY= # empty on purpose\n'), false);
    assert.equal(re.test('GEMINI_API_KEY=""\n'), false);
    assert.equal(re.test('# GEMINI_API_KEY=\n'), false);
    // A value is still caught.
    assert.equal(re.test('GEMINI_API_KEY=abc\n'), true);
    assert.equal(re.test('  GEMINI_API_KEY = abc\n'), true);
    assert.equal(re.test('export GEMINI_API_KEY=abc\n'), true);
    assert.equal(re.test('OTHER=1\nGEMINI_API_KEY="abc"\n'), true);
  });

  it('.env.example sets no value for any key/secret/token/password variable', () => {
    const lines = readFileSync(join(ROOT, '.env.example'), 'utf8').split('\n');
    const offenders = lines.filter((l) => /^\s*[A-Z0-9_]*(KEY|SECRET|TOKEN|PASSWORD)[A-Z0-9_]*\s*=\s*\S+/.test(l));
    assert.deepEqual(offenders, []);
  });

  it('.gitignore excludes .env and secret files but keeps .env.example', () => {
    const gi = readFileSync(join(ROOT, '.gitignore'), 'utf8').split('\n').map((l) => l.trim());
    for (const required of ['.env', '.env.*', '!.env.example', '*.pem', '*.key', 'secrets/']) {
      assert.ok(gi.includes(required), `.gitignore missing ${required}`);
    }
  });

  it('no .env file or key material is present in the tree', () => {
    const bad = files.map((f) => relative(ROOT, f)).filter((f) => /(^|\/)\.env$/.test(f) || /\.(pem|key|p12|pfx)$/.test(f));
    assert.deepEqual(bad, []);
  });

  // Phase 05-B3: the Gemini credential is read in exactly one place.
  const GEMINI_KEY_READER = 'src/config/translationProvider.js';

  it('only the provider config module may reference GEMINI_API_KEY in src/', () => {
    const src = files.filter((f) => relative(ROOT, f).startsWith('src/'));
    const hits = src
      .filter((f) => /process\.env\.GEMINI|GEMINI_API_KEY/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(ROOT, f));
    assert.deepEqual(hits, [GEMINI_KEY_READER]);
  });

  it('no provider adapter reads process.env directly', () => {
    const adapters = files.filter((f) => relative(ROOT, f).startsWith('src/infrastructure/providers/'));
    assert.ok(adapters.length >= 3, 'expected the B3 provider files');
    const hits = adapters.filter((f) => /process\.env/.test(readFileSync(f, 'utf8')));
    assert.deepEqual(hits.map((f) => relative(ROOT, f)), []);
  });

  it('HTTP responses and logs never contain secret environment values', async () => {
    const sentinel = 'SENTINEL-SECRET-VALUE-12345';
    const srv = await startTestServer({ GEMINI_API_KEY: sentinel });
    try {
      const bodies = [];
      for (const path of ['/health', '/missing']) {
        bodies.push(await (await fetch(`${srv.baseUrl}${path}`)).text());
      }
      assert.ok(!bodies.join('').includes(sentinel));
      assert.ok(!srv.logs.join('').includes(sentinel));
    } finally {
      await srv.close();
    }
  });
});

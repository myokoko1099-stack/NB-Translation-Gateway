# Changed files — Phase 05-B2.1 (relative to B1 `c19e83f`)

## Added
- `src/config/auth.js` — `GATEWAY_CLIENT_TOKEN` loading / validation, production-required rule
- `src/infrastructure/http/auth.js` — Bearer parsing, timing-safe comparison, uniform 401 error
- `test/auth.test.js` — 22 authentication tests
- `B2.1-REPORT.md`
- `CHANGED_FILES-B2.1.md`

## Modified
- `src/infrastructure/http/server.js` — authenticate before handler for `/v1/translate`
- `src/infrastructure/http/compose.js` — accepts `auth`, refuses production without auth
- `src/index.js` — loads auth config; startup fails in production without token
- `test/helpers.js` — builds auth from the env map like production (backward compatible)
- `.env.example` — `GATEWAY_CLIENT_TOKEN=` (empty)
- `README.md` — authentication section, test count, config notes

## Unchanged (included in ZIP only so the suite can run)
`.gitignore`, `package.json`, `src/meta.js`, `src/config/{config,profiles,secrets}.js`, `src/domain/*`, `src/application/*`, `src/ports/*`, `src/infrastructure/logging/logger.js`, `test/{config,health,translate,secret-exposure}.test.js`

## Not included
B1 documents: `ARCHITECTURE.md`, `HOSTING-DECISION.md`, `SECURITY-NOTES.md`, `TEST-REPORT.md`, `CHANGED_FILES.md` (unchanged in B2.1).

# Phase 05-B2.4 — Changed files

## Updated
- `src/infrastructure/http/server.js` — safe client error mapping and bounded/redacted error logging.
- `src/index.js` — production guard and exact client-token redaction in logger.
- `src/infrastructure/logging/logger.js` — redact every log message and structured field; backward-compatible signature.
- `README.md` — current security status and test instructions.
- `SECURITY-NOTES.md` — replace obsolete B1 security statements.
- `.env.example` — document production logging constraint; no secret values.

## Added
- `src/infrastructure/logging/redact.js`
- `src/infrastructure/http/errorResponse.js`
- `src/config/productionGuard.js`
- `test/redact.test.js`
- `test/loggerRedaction.test.js`
- `test/errorResponse.test.js`
- `test/productionGuard.test.js`
- `B2.4-REPORT.md`
- `CHANGED_FILES-B2.4.md`
- `TERMUX-PUSH-GUIDE.md`

No package.json or CI workflow changes are required: the project already uses Node.js built-in tests with the glob `test/*.test.js` and a Node 20/22 CI matrix.

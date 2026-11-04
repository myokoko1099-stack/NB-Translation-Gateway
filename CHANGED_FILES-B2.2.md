# Changed files — Phase 05-B2.2 (relative to main @ ef4b2da)

## Added
- `src/infrastructure/http/rateLimiter.js` — in-memory fixed-window limiter, sweep, key cap
- `src/infrastructure/http/clientIp.js` — client IP resolution (peer address; opt-in trusted proxy hops; IPv6 /64)
- `test/rateLimit.test.js` — 33 tests
- `B2.2-REPORT.md`
- `CHANGED_FILES-B2.2.md`

## Modified
- `src/config/config.js` — parse `GATEWAY_RATE_LIMIT_MAX`, `GATEWAY_RATE_LIMIT_WINDOW_MS`, `GATEWAY_TRUSTED_PROXY_HOPS`; expose `config.rateLimit`
- `src/config/profiles.js` — rate limit defaults
- `src/infrastructure/http/server.js` — rate limit after authentication; 429 + headers
- `src/infrastructure/http/compose.js` — create limiter, stop its timer on server close, `rateLimiter` override
- `src/index.js` — rate limit settings in the startup log
- `.env.example` — three commented variables with defaults (no secrets)
- `README.md` — Rate Limiting section, config, test count, doc table

## Unchanged
Everything else, including all B1/B2.1 source and tests (`test/helpers.js` unchanged), `.github/workflows/test.yml`, `package.json` (no dependencies added).

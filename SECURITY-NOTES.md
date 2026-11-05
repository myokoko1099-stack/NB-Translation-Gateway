# SECURITY-NOTES.md — updated through Phase 05-B3

## Secret handling
- Never commit real API keys, client tokens, `.env` files, private keys, or provider credentials. Keep deployment secrets in the hosting provider's secret/environment settings.
- `GATEWAY_CLIENT_TOKEN` protects `POST /v1/translate`; `GET /health` remains public. In production the token is required (startup fails without it).
- The Gemini API key is used on the server only. It must never be placed in the Android APK, in the repository, or in `.env.example` (which keeps it empty).
- `Secret` wrappers redact during string/JSON/inspect conversion. The Gemini key is loaded as a `Secret` by `src/config/translationProvider.js`, which is the only source file allowed to reference the variable (enforced by `test/secret-exposure.test.js`).
- Phase 05-B3: `src/index.js` passes the client token and the Gemini key to the logger, which scrubs their exact values (also URL-encoded) in addition to redacting sensitive property names and common credential patterns.
- Redaction is defense in depth, not permission to log request bodies, authorization headers, cookies, provider payloads, or novel text. Do not log those values.

## HTTP and error handling
- CORS allowlist, security headers, authentication, rate limiting, request content-type/size/timeout checks remain active and keep their order. A request that fails any of them never reaches the translation provider.
- Phase 05-B3: `errorResponse.js` is now wired into `server.js`; every error response passes through `toClientError()`.
  - Unexpected (non-`AppError`) errors become a generic `500 INTERNAL_ERROR`; stack traces and internal messages are not returned.
  - `AppError` with status 500+ keeps only its status and a well-formed code. The message is replaced by a fixed generic text (`Upstream service error.`, `Service unavailable.`, `Upstream service timed out.`, `Not implemented.`); details and extra headers are dropped, so a provider cannot leak upstream text.
  - `AppError` with status below 500 is a deliberate client-safe error; its text is redacted and its headers (`WWW-Authenticate`, `Retry-After`, `Allow`, `Connection`) are kept.
- Logging of errors: unexpected errors log a bounded, redacted name/message; 5xx `AppError` logs contain only request ID, status and code. Avoid adding raw upstream errors to logs.
- Behaviour change in B3: the 501 response body message is now `Not implemented.` (it used to be the longer build-specific text). Status `501` and code `NOT_IMPLEMENTED` are unchanged.

## Gemini provider (Phase 05-B3)
- Endpoint `https://generativelanguage.googleapis.com/v1beta/interactions` is a constant in `geminiProvider.js`. No environment variable or request field can change it.
- Auth via the `x-goog-api-key` header only (never in the URL or body). Requests use `store: false`, `redirect: 'error'` and `AbortSignal.timeout(GEMINI_TIMEOUT_MS)`. There is no automatic retry.
- Only a `completed` interaction with non-empty `model_output` text is accepted; anything else is an error.
- Error mapping: 400/401/403/404/500 and other unexpected statuses -> `502 UPSTREAM_ERROR`; 429 -> `429 UPSTREAM_RATE_LIMITED`; 503 -> `503 UPSTREAM_UNAVAILABLE`; timeout -> `504 UPSTREAM_TIMEOUT`; network failure, invalid JSON, empty or incomplete response -> `502`. Raw Gemini error bodies, status text, URLs and the upstream `Retry-After` are never returned.
- The provider logs a reason category and numeric status only. Request text and translated text are never logged.
- The submitted text is sent as `input`, the rules as `system_instruction`; the rules tell the model to treat the input as untrusted data. This reduces, but cannot eliminate, prompt-injection effects on the translation output.
- Novel text is sent to Google. `store: false` only controls interaction storage for later retrieval; check Google's current Gemini API terms for how content is handled on the plan you use.

## Production configuration
- `PORT` and `GATEWAY_CLIENT_TOKEN` remain required in production (`loadAuthConfig` and `buildApp` enforce this).
- `TRANSLATION_PROVIDER=gemini` requires `GEMINI_API_KEY`; invalid `GEMINI_*` values stop startup (variable names only are reported).
- `src/config/productionGuard.js` (B2.4) is **not called** from `src/index.js` at base commit b944e9c, and B3 deliberately keeps it unwired. Consequently the guard's extra checks are NOT active at runtime: placeholder client-token values are not rejected, and `LOG_LEVEL=debug` is not rejected in production. The module is only exercised by its own unit tests. Earlier notes that described these checks as active were inaccurate. Wiring it is a separate, behaviour-changing step.
- For public production browser clients, configure HTTPS origins in `GATEWAY_CORS_ALLOWED_ORIGINS`. The application does not newly reject HTTP origins because local development examples remain supported.

## Remaining limitations
- Pattern-based redaction cannot guarantee detection of every possible credential format. Never pass arbitrary provider error objects or request headers to logs.
- Rate-limit state is in-memory and per process; distributed limits and quota management are not included. Each translation request consumes upstream Gemini quota; the gateway rate limit is the only protection against quota exhaustion.
- No retry, circuit breaker or fallback provider: an upstream failure is reported to the client immediately.
- TLS termination and secret storage at rest are hosting-platform responsibilities and must be verified for the selected host.
- Git history is not scanned by the runtime test. If a credential was ever committed, revoke/rotate it; deleting the current file is insufficient.

## Verification
- B3 adds three test files (`geminiConfig`, `geminiProvider`, `geminiGateway`) that use a mock `fetch` only: no real Gemini call, no real key. `test/secret-exposure.test.js` was updated for B3.
- Tests were not run locally. They are not claimed as passed until GitHub Actions completes on Node 20 and Node 22 for the B3 pull request.

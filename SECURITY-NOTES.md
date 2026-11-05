# SECURITY-NOTES.md — updated through Phase 05-B2.4

## Secret handling
- Never commit real API keys, client tokens, `.env` files, private keys, or provider credentials. Keep deployment secrets in the hosting provider's secret/environment settings.
- `GATEWAY_CLIENT_TOKEN` protects `POST /v1/translate`; `GET /health` remains public. Production startup requires a non-placeholder client token.
- `Secret` wrappers redact during string/JSON/inspect conversion. The logger additionally redacts sensitive property names, common credential patterns, and the configured client token's exact value.
- Redaction is defense in depth, not permission to log request bodies, authorization headers, cookies, provider payloads, or novel text. Do not log those values.

## HTTP and error handling
- CORS allowlist, security headers, authentication, rate limiting, request content-type/size/timeout checks remain active.
- Unexpected errors map to a generic `500 INTERNAL_ERROR`; stack traces and internal messages are not returned to clients. For `AppError` status 500+, message/details/extra headers are suppressed. Client-safe 4xx messages are passed through redaction.
- Server-side error logs contain a bounded error name/message after shape-based redaction; 5xx `AppError` logs contain only request ID and stable error code. Avoid adding raw upstream errors to logs.

## Production configuration
- `PORT` and `GATEWAY_CLIENT_TOKEN` remain required in production. Obvious placeholder token values are rejected.
- `LOG_LEVEL=debug` is rejected in production; use `info`, `warn`, `error`, or `silent`. Existing token minimum length is unchanged.
- For public production browser clients, configure HTTPS origins in `GATEWAY_CORS_ALLOWED_ORIGINS`. The application does not newly reject HTTP origins because local development examples remain supported.

## Remaining limitations
- Pattern-based redaction cannot guarantee detection of every possible credential format. Never pass arbitrary provider error objects or request headers to logs.
- Rate-limit state is in-memory and per process; distributed limits and quota management are not included.
- TLS termination and secret storage at rest are hosting-platform responsibilities and must be verified for the selected host.
- Git history is not scanned by the runtime test. If a credential was ever committed, revoke/rotate it; deleting the current file is insufficient.

## Verification
- B2.4 adds built-in Node tests for redaction, logger safety, client error mapping, and production guard behavior.
- Tests are not claimed as passed until GitHub Actions completes on Node 20 and Node 22 for the B2.4 pull request.



## Security Hardening (Phase 05-B2.4)

- Logger output is passed through a redactor for sensitive field names, common credential formats, Bearer/Authorization values, and the configured client token. Do not log request bodies, novel text, raw headers, or provider payloads.
- Unexpected errors return a generic `500 INTERNAL_ERROR`. For server-side `AppError` responses (5xx), internal message/details/extra headers are suppressed.
- Production startup rejects missing or obvious placeholder `GATEWAY_CLIENT_TOKEN` values and rejects `LOG_LEVEL=debug`. Existing token length requirements are unchanged.
- If the hosting dashboard currently sets `LOG_LEVEL=debug`, change it to `info` (or `warn`/`error`) before deploying B2.4.
- Tests are run by GitHub Actions using Node 20 and 22; do not treat the phase as verified until both jobs pass.

The existing `npm test` script already discovers `test/*.test.js`; no new package dependencies or package.json changes are required.

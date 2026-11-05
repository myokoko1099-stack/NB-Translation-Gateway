import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppError } from '../src/domain/errors.js';
import { toClientError } from '../src/infrastructure/http/errorResponse.js';

describe('B2.4 client error sanitisation', () => {
  it('converts unknown errors to a generic 500 without internal details', () => {
    const result = toClientError(new Error('private path /srv/app and secret token-xyz'));
    assert.deepEqual(result, { status: 500, code: 'INTERNAL_ERROR', message: 'Internal server error.' });
  });
  it('hides message, details and headers for 5xx AppError', () => {
    const result = toClientError(new AppError(502, 'UPSTREAM_FAILURE', 'api_key=hidden-value', [{ issue: 'secret' }], { 'x-internal': 'hidden' }));
    assert.deepEqual(result, { status: 502, code: 'UPSTREAM_FAILURE', message: 'Upstream service error.' });
  });
  it('preserves safe 4xx contract and redacts credential-like text', () => {
    const result = toClientError(new AppError(401, 'UNAUTHORIZED', 'Bearer private-token-123', undefined, { 'www-authenticate': 'Bearer' }));
    assert.equal(result.status, 401);
    assert.equal(result.code, 'UNAUTHORIZED');
    assert.ok(!result.message.includes('private-token-123'));
    assert.equal(result.headers['www-authenticate'], 'Bearer');
  });
  it('rejects malformed status and code values safely', () => {
    const error = new AppError(200, 'bad code', 'message');
    const result = toClientError(error);
    assert.equal(result.status, 500);
    assert.equal(result.code, 'INTERNAL_ERROR');
  });
});

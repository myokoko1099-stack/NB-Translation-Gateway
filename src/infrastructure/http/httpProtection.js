import { AppError } from '../../domain/errors.js';

/**
 * Phase 05-B2.3: request-body protection.
 *
 * - Content-Type must be application/json (charset, if present, must be UTF-8)  -> 415
 * - Declared Content-Length over the limit is refused before reading anything   -> 413
 * - Streamed / chunked bodies are counted and aborted at the limit              -> 413
 * - A body that is not fully received within the timeout                        -> 408
 *
 * Every error here sets `Connection: close` so an unread/oversized body cannot
 * keep the socket busy. These checks run only AFTER authentication and rate
 * limiting (see server.js), exactly as in B2.1/B2.2.
 */

function unsupportedMediaType() {
  return new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json.', undefined, {
    connection: 'close',
  });
}

function payloadTooLarge() {
  return new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.', undefined, { connection: 'close' });
}

function requestTimeout() {
  return new AppError(408, 'REQUEST_TIMEOUT', 'Request body was not received in time.', undefined, {
    connection: 'close',
  });
}

/**
 * Accept `application/json` with an optional `charset=utf-8` parameter.
 * Any other media type, or any other charset, is rejected with 415.
 *
 * @param {import('node:http').IncomingMessage} req
 * @throws {AppError} 415
 */
export function assertJsonContentType(req) {
  const raw = req.headers['content-type'];
  if (typeof raw !== 'string') throw unsupportedMediaType();

  const [type, ...params] = raw.split(';');
  if (type.trim().toLowerCase() !== 'application/json') throw unsupportedMediaType();

  for (const param of params) {
    const eq = param.indexOf('=');
    if (eq === -1) continue;
    if (param.slice(0, eq).trim().toLowerCase() !== 'charset') continue;
    const charset = param
      .slice(eq + 1)
      .trim()
      .replace(/^"(.*)"$/, '$1')
      .toLowerCase();
    if (charset !== 'utf-8' && charset !== 'utf8') throw unsupportedMediaType();
  }
}

/**
 * Read the request body with a hard size limit and a deadline.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {{ maxBytes: number, timeoutMs: number }} limits
 * @returns {Promise<Buffer>}
 * @throws {AppError} 413 / 408 / 400
 */
export function readBody(req, { maxBytes, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;

    function finish(settle, value, stopReading) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      req.off('close', onClose);
      // Stop pulling bytes from an oversized / stalled / failed upload; the
      // error response carries `Connection: close`, so the socket is dropped
      // after it is sent.
      if (stopReading) req.pause();
      settle(value);
    }

    function onData(chunk) {
      size += chunk.length;
      if (size > maxBytes) {
        finish(reject, payloadTooLarge(), true);
        return;
      }
      chunks.push(chunk);
    }
    function onEnd() {
      finish(resolve, Buffer.concat(chunks), false);
    }
    function onError() {
      finish(reject, new AppError(400, 'REQUEST_ABORTED', 'Request could not be read.', undefined, { connection: 'close' }), true);
    }
    function onClose() {
      // 'close' after a complete request is normal; before completion it means
      // the client went away mid-upload.
      if (!req.complete) onError();
    }

    const timer = setTimeout(() => finish(reject, requestTimeout(), true), timeoutMs);
    timer.unref();

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
    req.on('close', onClose);
  });
}

/**
 * Validate Content-Type, enforce the size limit and the read deadline, then
 * parse the JSON body.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {{ maxBytes: number, timeoutMs: number }} limits
 */
export async function readJsonBody(req, { maxBytes, timeoutMs }) {
  assertJsonContentType(req);

  const declared = req.headers['content-length'];
  if (declared !== undefined && Number(declared) > maxBytes) {
    throw payloadTooLarge();
  }

  const body = await readBody(req, { maxBytes, timeoutMs });
  if (body.length === 0) {
    throw new AppError(400, 'INVALID_JSON', 'Request body is required.');
  }
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    throw new AppError(400, 'INVALID_JSON', 'Request body is not valid JSON.');
  }
}

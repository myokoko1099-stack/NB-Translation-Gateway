/**
 * Phase 05-B2.3: security headers attached to EVERY response this server
 * produces (success, error, and CORS preflight).
 *
 * This is a JSON API: it never serves HTML, so the CSP forbids everything and
 * the page can never be framed.
 */
export const SECURITY_HEADERS = Object.freeze({
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  // Deny every powerful browser feature; an API response needs none of them.
  'permissions-policy':
    'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()',
});

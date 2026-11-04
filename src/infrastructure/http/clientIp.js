import { isIP, isIPv4 } from 'node:net';

/** Expand a (valid) IPv6 text address to eight 16-bit numbers. */
function expandIPv6(addr) {
  let a = addr.split('%')[0].toLowerCase();
  const tail4 = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(a);
  if (tail4) {
    const o = tail4[2].split('.').map(Number);
    a = `${tail4[1]}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const halves = a.split('::');
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  return [...head, ...Array(fill).fill('0'), ...tail].map((g) => parseInt(g, 16));
}

/**
 * Map an IP address to its rate-limit key:
 * - IPv4 -> the address itself
 * - IPv4-mapped IPv6 (::ffff:a.b.c.d) -> the IPv4 address
 * - other IPv6 -> its /64 prefix (a single host/subscriber controls a whole
 *   /64, so keying on the full address would make the limit trivial to evade)
 *
 * @param {string} addr a valid IPv4 or IPv6 address
 * @returns {string}
 */
export function ipToKey(addr) {
  if (isIPv4(addr)) return addr;
  const g = expandIPv6(addr);
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
    return `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;
  }
  return `${g.slice(0, 4).map((x) => x.toString(16)).join(':')}::/64`;
}

/**
 * Determine the client identity used for rate limiting.
 *
 * Default (trustedProxyHops = 0): the TCP peer address only. X-Forwarded-For
 * is NEVER consulted, so a client cannot choose its own identity.
 *
 * With trustedProxyHops = N > 0 (operator asserts that exactly N trusted
 * reverse proxies sit in front and that the server is unreachable except
 * through them): the client is the N-th entry from the RIGHT of
 * X-Forwarded-For, i.e. the last address appended by a trusted proxy. Entries
 * further left are client-supplied and ignored. A missing, short or invalid
 * header falls back to the TCP peer address.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {number} trustedProxyHops
 * @returns {string}
 */
export function resolveClientIp(req, trustedProxyHops) {
  let candidate = req.socket?.remoteAddress;

  if (trustedProxyHops > 0) {
    const raw = req.headers['x-forwarded-for'];
    if (typeof raw === 'string') {
      const parts = raw.split(',').map((p) => p.trim());
      if (parts.length >= trustedProxyHops) {
        const fromProxy = parts[parts.length - trustedProxyHops];
        if (isIP(fromProxy) !== 0) candidate = fromProxy;
      }
    }
  }

  if (typeof candidate !== 'string') return 'unknown';
  const bare = candidate.split('%')[0];
  return isIP(bare) === 0 ? 'unknown' : ipToKey(bare);
}


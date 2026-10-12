import { describe, expect, it } from 'vitest';

import { normalizeIp } from './net.ts';

describe('normalizeIp', () => {
  it('garde le premier hop de X-Forwarded-For', () => {
    expect(normalizeIp('203.0.113.7, 10.0.0.1')).toBe('203.0.113.7');
    expect(normalizeIp('  198.51.100.2  ')).toBe('198.51.100.2');
  });

  it('accepte une IPv6, y compris à IPv4 intégrée', () => {
    expect(normalizeIp('2001:db8::1')).toBe('2001:db8::1');
    expect(normalizeIp('::ffff:192.0.2.1, 10.0.0.1')).toBe('::ffff:192.0.2.1');
  });

  it('écarte une valeur absente, vide ou qui n’est pas une IP', () => {
    expect(normalizeIp(null)).toBeUndefined();
    expect(normalizeIp('')).toBeUndefined();
    expect(normalizeIp(' , 10.0.0.1')).toBeUndefined();
    expect(normalizeIp('unknown')).toBeUndefined();
    expect(normalizeIp('256.1.1.1')).toBeUndefined();
    expect(normalizeIp('1.2.3')).toBeUndefined();
    expect(normalizeIp("1.2.3.4'; DROP TABLE x")).toBeUndefined();
    expect(normalizeIp('fe80::1%eth0')).toBeUndefined();
  });
});

import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { proxy } from './proxy.ts';

function request(path: string, ip: string, method = 'POST'): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, { method, headers: { 'x-forwarded-for': ip } });
}

describe('proxy — mot de passe oublié', () => {
  it('ferme le GET à jeton et refuse un jeton dans l’adresse', () => {
    expect(proxy(request('/api/auth/reset-password/abcdefghijklmnopqrstuvwx', '198.51.100.1', 'GET')).status).toBe(404);
    expect(proxy(request('/api/auth/reset-password?token=abc', '198.51.100.1')).status).toBe(400);
    expect(proxy(request('/api/auth/reset-password', '198.51.100.1')).status).toBe(200);
  });

  it.each(['/api/auth/request-password-reset', '/api/auth/reset-password'])(
    'limite %s à 10 requêtes par 15 minutes et par IP',
    (path) => {
      const ip = path.includes('request') ? '198.51.100.20' : '198.51.100.21';
      for (let i = 0; i < 10; i += 1) expect(proxy(request(path, ip)).status).toBe(200);
      const limited = proxy(request(path, ip));
      expect(limited.status).toBe(429);
      const retryAfter = Number(limited.headers.get('Retry-After'));
      expect(retryAfter).toBeGreaterThan(14 * 60);
      expect(retryAfter).toBeLessThanOrEqual(15 * 60);
      expect(proxy(request(path, '198.51.100.22')).status).toBe(200);
      // La limite propre ne consomme pas celle du reste de /api/auth.
      expect(proxy(request('/api/auth/get-session', ip, 'GET')).status).toBe(200);
    },
  );
});

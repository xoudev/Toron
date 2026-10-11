import { PASSWORD_RESET_REQUEST_FLOOR_MS } from '@toron/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAuthRoute, RESET_REQUEST_PATH } from './auth-route.ts';

const ORIGIN = 'http://localhost:3000';

function post(path: string): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'camille.poirier@meridiane-logistics.example' }),
  });
}

const immediate = () => async () => Response.json({ status: true });

async function timed(run: () => Promise<Response>): Promise<{ res: Response; ms: number }> {
  const started = performance.now();
  const res = await run();
  return { res, ms: performance.now() - started };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('route /api/auth — plancher de durée', () => {
  it('retient la demande de lien au moins le temps plancher', async () => {
    const route = createAuthRoute(immediate);
    const { res, ms } = await timed(() => route.POST(post(RESET_REQUEST_PATH)));
    expect(res.status).toBe(200);
    // Marge de 5 ms : setTimeout peut se déclencher une milliseconde plus tôt.
    expect(ms).toBeGreaterThanOrEqual(PASSWORD_RESET_REQUEST_FLOOR_MS - 5);
  });

  it('ne retarde pas les autres chemins', async () => {
    const route = createAuthRoute(immediate);
    const signIn = await timed(() => route.POST(post('/api/auth/sign-in/email')));
    const session = await timed(() => route.GET(new Request(`${ORIGIN}/api/auth/get-session`)));
    expect(signIn.ms).toBeLessThan(PASSWORD_RESET_REQUEST_FLOOR_MS / 2);
    expect(session.ms).toBeLessThan(PASSWORD_RESET_REQUEST_FLOOR_MS / 2);
  });
});

describe('route /api/auth — erreur interne', () => {
  it('répond 500 au format { code, message, correlationId } sans écrire le message de l’erreur', async () => {
    const written: string[] = [];
    for (const level of ['log', 'warn', 'error'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        written.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
      });
    }
    const failing = () => async (): Promise<Response> => {
      throw new Error('Failed query: select … params: victime@meridiane-logistics.example', {
        cause: Object.assign(new Error('relation absente'), { code: '42P01' }),
      });
    };
    const route = createAuthRoute(failing);

    for (const res of [await route.POST(post(RESET_REQUEST_PATH)), await route.GET(new Request(`${ORIGIN}/api/auth/get-session`))]) {
      expect(res.status).toBe(500);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toMatchObject({ code: 'ERREUR_INTERNE', message: expect.stringContaining('réessayez') });
      expect(body.correlationId).toMatch(/^[0-9a-f-]{36}$/);
      expect(JSON.stringify(body)).not.toContain('@');
    }
    const all = written.join('\n');
    expect(all).toContain('[auth] erreur interne');
    expect(all).toContain('42P01');
    expect(all).not.toContain('@');
    expect(all).not.toContain('Failed query');
  });

  it('couvre aussi l’échec de construction de l’instance', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const route = createAuthRoute(() => {
      throw new Error('BETTER_AUTH_SECRET manquant');
    });
    expect((await route.GET(new Request(`${ORIGIN}/api/auth/get-session`))).status).toBe(500);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OutgoingEmail } from '../mailer.ts';
import { createScalewayTemMailer, parseRetryAfter, temEndpoint } from './scaleway-tem.ts';

const SECRET = '11111111-2222-4333-8444-555555555555';
const PROJECT = '9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b';
const TO = 'camille.poirier@meridiane-logistics.fr';
const EMAIL: OutgoingEmail = {
  reference: '0f8b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d',
  to: TO,
  subject: 'Réinitialisation de votre mot de passe Toron',
  text: 'texte',
  html: '<p>html</p>',
  sendBefore: new Date('2026-10-10T12:30:00.000Z'),
};

let output: string[] = [];

beforeEach(() => {
  output = [];
  const capture = (...args: unknown[]) => { output.push(args.map(String).join(' ')); };
  vi.spyOn(console, 'warn').mockImplementation(capture);
  vi.spyOn(console, 'error').mockImplementation(capture);
  vi.spyOn(console, 'log').mockImplementation(capture);
  vi.spyOn(console, 'info').mockImplementation(capture);
});

afterEach(() => {
  // Le corps de réponse cite l'adresse : il ne doit jamais sortir du transport.
  expect(output.join('\n')).not.toContain('@');
  vi.restoreAllMocks();
});

function mailerWith(response: () => Response | Promise<Response>, timeoutMs?: number) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return response();
  }) as typeof fetch;
  const mailer = createScalewayTemMailer({
    secretKey: SECRET, projectId: PROJECT, region: 'fr-par', from: 'ne-pas-repondre@notifications.toron.eu',
    fetch: fetchMock, ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
  return { mailer, calls };
}

const providerBody = JSON.stringify({
  emails: [{ id: 'f6a5b4c3-d2e1-4f0a-9b8c-7d6e5f4a3b2c', message_id: '<abc123@tem.scaleway.com>', mail_rcpt: TO, subject: EMAIL.subject, status: 'new' }],
});

describe('transport Scaleway TEM', () => {
  it('respecte le contrat de l’API : URL, jeton, corps, redirection et délai', async () => {
    const { mailer, calls } = mailerWith(() => new Response(providerBody, { status: 200 }));
    const outcome = await mailer.send(EMAIL);
    expect(outcome).toEqual({ ok: true, providerMessageId: '<abc123@tem.scaleway.com>' });

    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;
    expect(url).toBe('https://api.scaleway.com/transactional-email/v1alpha1/regions/fr-par/emails');
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Auth-Token']).toBe(SECRET);
    expect(headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toEqual({
      from: { email: 'ne-pas-repondre@notifications.toron.eu', name: 'Toron' },
      to: [{ email: TO }],
      subject: EMAIL.subject,
      text: 'texte',
      html: '<p>html</p>',
      project_id: PROJECT,
      send_before: '2026-10-10T12:30:00.000Z',
      additional_headers: [
        { key: 'Auto-Submitted', value: 'auto-generated' },
        { key: 'X-Auto-Response-Suppress', value: 'All' },
      ],
    });
  });

  it('se contente de l’id quand message_id manque, et d’aucun id pour un corps illisible', async () => {
    const onlyId = mailerWith(() => new Response(JSON.stringify({ emails: [{ id: 'abc' }] }), { status: 200 }));
    expect(await onlyId.mailer.send(EMAIL)).toEqual({ ok: true, providerMessageId: 'abc' });
    const garbage = mailerWith(() => new Response('pas du json', { status: 200 }));
    expect(await garbage.mailer.send(EMAIL)).toEqual({ ok: true, providerMessageId: null });
  });

  it('classe 400 en refus définitif', async () => {
    const { mailer } = mailerWith(() => new Response(JSON.stringify({ message: `adresse ${TO} refusée` }), { status: 400 }));
    const outcome = await mailer.send(EMAIL);
    expect(outcome).toEqual({ ok: false, verdict: { effect: 'definitif', code: 'REFUS_FOURNISSEUR' }, httpStatus: 400 });
    expect(JSON.stringify(outcome)).not.toContain('@');
  });

  it('classe 401 et 404 en erreur de configuration, à libérer', async () => {
    for (const status of [401, 404]) {
      const { mailer } = mailerWith(() => new Response('{}', { status }));
      expect(await mailer.send(EMAIL)).toEqual({ ok: false, verdict: { effect: 'liberation', code: 'CONFIGURATION' }, httpStatus: status });
    }
  });

  it('classe 429 en reprise et lit Retry-After', async () => {
    const { mailer } = mailerWith(() => new Response('{}', { status: 429, headers: { 'Retry-After': '120' } }));
    expect(await mailer.send(EMAIL)).toEqual({
      ok: false, verdict: { effect: 'reprise', code: 'LIMITE_FOURNISSEUR' }, httpStatus: 429, retryAfterSeconds: 120,
    });
  });

  it('classe 503 en reprise', async () => {
    const { mailer } = mailerWith(() => new Response(`indisponible pour ${TO}`, { status: 503 }));
    expect(await mailer.send(EMAIL)).toEqual({ ok: false, verdict: { effect: 'reprise', code: 'FOURNISSEUR_INDISPONIBLE' }, httpStatus: 503 });
  });

  it('classe un délai dépassé en reprise DELAI', async () => {
    const fetchMock = ((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
    })) as unknown as typeof fetch;
    const mailer = createScalewayTemMailer({
      secretKey: SECRET, projectId: PROJECT, region: 'fr-par', from: 'ne-pas-repondre@notifications.toron.eu',
      fetch: fetchMock, timeoutMs: 20,
    });
    expect(await mailer.send(EMAIL)).toEqual({ ok: false, verdict: { effect: 'reprise', code: 'DELAI' } });
  });

  it('classe une erreur réseau, redirection comprise, en reprise RESEAU', async () => {
    const { mailer } = mailerWith(() => { throw new TypeError(`fetch failed pour ${TO}`); });
    expect(await mailer.send(EMAIL)).toEqual({ ok: false, verdict: { effect: 'reprise', code: 'RESEAU' } });
  });

  it('refuse une région qui sortirait du chemin de l’API', () => {
    expect(() => temEndpoint('fr-par/../../autre')).toThrow(/Région Scaleway invalide/);
  });
});

describe('Retry-After', () => {
  const now = new Date('2026-10-10T12:00:00.000Z');
  it('lit des secondes ou une date HTTP, borne à 24 heures, ignore le reste', () => {
    expect(parseRetryAfter('30', now)).toBe(30);
    expect(parseRetryAfter('Sat, 10 Oct 2026 12:02:00 GMT', now)).toBe(120);
    expect(parseRetryAfter('999999', now)).toBe(86_400);
    expect(parseRetryAfter('0', now)).toBeUndefined();
    expect(parseRetryAfter('demain', now)).toBeUndefined();
    expect(parseRetryAfter(null, now)).toBeUndefined();
  });
});

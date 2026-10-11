// Transport Scaleway Transactional Email, par l'API HTTPS v1alpha1 et sans
// SDK. La réponse cite l'adresse et l'objet du message : son corps n'est
// jamais journalisé ni stocké, seul l'identifiant du message en est extrait.

import { classifyProviderResponse } from '@toron/core';
import { z } from 'zod';

import type { Mailer, OutgoingEmail, SendFailure, SendOutcome } from '../mailer.ts';

export interface ScalewayTemConfig {
  secretKey: string;
  projectId: string;
  region: string;
  /** Adresse d'expédition seule ; le nom affiché est fixe. */
  from: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export const TEM_TIMEOUT_MS = 10_000;
const MAX_RETRY_AFTER_SECONDS = 86_400;
const MAX_PROVIDER_ID_LENGTH = 200;

export function temEndpoint(region: string): string {
  if (!/^[a-z]{2}-[a-z]{3}$/.test(region)) throw new Error('Région Scaleway invalide : forme fr-par attendue.');
  return `https://api.scaleway.com/transactional-email/v1alpha1/regions/${region}/emails`;
}

// Lecture tolérante : seuls les identifiants comptent, le reste est ignoré.
const temResponse = z.object({
  emails: z.array(z.object({ id: z.string().optional(), message_id: z.string().optional() })).optional(),
});

/** Retry-After en secondes ou en date HTTP, borné à 24 heures. */
export function parseRetryAfter(value: string | null, now: Date): number | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  const seconds = /^\d+$/.test(trimmed) ? Number(trimmed) : (Date.parse(trimmed) - now.getTime()) / 1000;
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return Math.min(Math.ceil(seconds), MAX_RETRY_AFTER_SECONDS);
}

function providerId(body: unknown): string | null {
  const parsed = temResponse.safeParse(body);
  if (!parsed.success) return null;
  const first = parsed.data.emails?.[0];
  const id = first?.message_id ?? first?.id ?? null;
  if (id === null || id === '' || id.length > MAX_PROVIDER_ID_LENGTH || /[\p{Cc}\s]/u.test(id)) return null;
  return id;
}

function failure(response: number | 'reseau' | 'delai', extra: Omit<SendFailure, 'ok' | 'verdict'> = {}): SendFailure {
  const verdict = classifyProviderResponse(response);
  // Une réponse 2xx n'arrive jamais ici ; par prudence, elle serait reprise.
  if (verdict.effect === 'envoye') return { ok: false, verdict: { effect: 'reprise', code: 'FOURNISSEUR_INDISPONIBLE' }, ...extra };
  return { ok: false, verdict, ...extra };
}

export function createScalewayTemMailer(config: ScalewayTemConfig): Mailer {
  const endpoint = temEndpoint(config.region);
  const fetchImpl = config.fetch ?? fetch;
  const timeoutMs = config.timeoutMs ?? TEM_TIMEOUT_MS;

  async function send(email: OutgoingEmail): Promise<SendOutcome> {
    const body = JSON.stringify({
      from: { email: config.from, name: 'Toron' },
      to: [{ email: email.to }],
      subject: email.subject,
      text: email.text,
      html: email.html,
      project_id: config.projectId,
      send_before: email.sendBefore.toISOString(),
      additional_headers: [
        { key: 'Auto-Submitted', value: 'auto-generated' },
        { key: 'X-Auto-Response-Suppress', value: 'All' },
      ],
    });
    let response: Response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Auth-Token': config.secretKey },
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const name = typeof err === 'object' && err !== null ? (err as { name?: unknown }).name : undefined;
      return failure(name === 'TimeoutError' || name === 'AbortError' ? 'delai' : 'reseau');
    }
    if (response.ok) {
      let parsed: unknown = null;
      try {
        parsed = await response.json();
      } catch {
        // Envoi accepté malgré un corps illisible : l'identifiant reste inconnu.
      }
      return { ok: true, providerMessageId: providerId(parsed) };
    }
    const retryAfterSeconds = parseRetryAfter(response.headers.get('retry-after'), new Date());
    // Corps abandonné sans lecture, pour libérer la connexion sans jamais l'exposer.
    await response.body?.cancel().catch(() => {});
    return failure(response.status, {
      httpStatus: response.status,
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    });
  }

  return { transport: 'scaleway', send };
}

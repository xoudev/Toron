import { describe, expect, it } from 'vitest';

import { EMAIL_KINDS, OUTBOX_EMAIL_KINDS, emailLink, isEmailKind, parseEmailParams, type EmailKind } from './kinds.ts';
import { MAX_HTML_BYTES, render, type RenderedEmail } from './render.ts';

const ORIGIN = 'https://app.toron.eu';
const TOKEN = 'JetonDeTest0000000000000';
const NOW = new Date('2026-10-10T12:32:00Z');

function renderKind(kind: EmailKind): { email: RenderedEmail; link: string } {
  const base = { origin: ORIGIN, now: NOW };
  switch (kind) {
    case 'mot_de_passe_reinitialisation': {
      const link = emailLink(kind, ORIGIN, TOKEN);
      return { link, email: render(kind, { ...base, link, params: {} }) };
    }
    case 'mot_de_passe_modifie': {
      const link = emailLink(kind, ORIGIN, null);
      return { link, email: render(kind, { ...base, link, params: { modifieLe: NOW.toISOString() } }) };
    }
    case 'essai': {
      const link = emailLink(kind, ORIGIN, null);
      return { link, email: render(kind, { ...base, link, params: {} }) };
    }
  }
}

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;
const KINDS = Object.keys(EMAIL_KINDS) as EmailKind[];

describe.each(KINDS)('gabarit %s', (kind) => {
  const { email, link } = renderKind(kind);

  it('HTML en français, titre égal à l’objet', () => {
    expect(email.html).toContain('<html lang="fr">');
    expect(email.html).toContain(`<title>${email.subject}</title>`);
    expect(email.html.startsWith('<!doctype html>')).toBe(true);
  });

  it('un seul lien, présent une fois dans le texte et une fois comme lien HTML', () => {
    expect(count(email.text, link)).toBe(1);
    expect(count(email.html, '<a ')).toBe(1);
    expect(count(email.html, `href="${link}"`)).toBe(1);
    // URL répétée en clair sous le bouton.
    expect(count(email.html, link)).toBe(2);
  });

  it('aucune autre URL, aucune image ni ressource distante', () => {
    for (const body of [email.text, email.html]) {
      const urls = body.match(/https?:\/\/[^\s"'<>]+/g) ?? [];
      expect(urls.every((u) => u === link)).toBe(true);
    }
    expect(email.html).not.toMatch(/<img|<link|<script|src=|url\(|@import|bgcolor/i);
  });

  it('aucune couleur imposée', () => {
    expect(email.html).not.toMatch(/(?:^|[;"\s-])color\s*:/i);
    expect(email.html).not.toMatch(/background/i);
    expect(email.html).toMatch(/font-size:16px/);
  });

  it('rappelle que Toron ne demande jamais de mot de passe', () => {
    expect(email.text).toContain('Toron ne vous demande jamais votre mot de passe');
    expect(email.html).toContain('Toron ne vous demande jamais votre mot de passe');
    expect(email.text).toContain('les réponses ne sont pas lues');
  });

  it('moins de 100 Ko', () => {
    expect(Buffer.byteLength(email.html, 'utf8')).toBeLessThan(MAX_HTML_BYTES);
  });

  it('objet sans caractère de contrôle', () => {
    expect(email.subject).not.toMatch(/[\p{Cc}\p{Cf}]/u);
  });
});

describe('réinitialisation du mot de passe', () => {
  const { email, link } = renderKind('mot_de_passe_reinitialisation');

  it('lien vers la page publique, jeton dans le fragment seulement', () => {
    expect(link).toBe(`${ORIGIN}/mot-de-passe/nouveau#jeton=${TOKEN}`);
    for (const body of [email.text, email.html]) {
      const positions = [...body.matchAll(new RegExp(TOKEN, 'g'))].map((m) => m.index);
      expect(positions.length).toBeGreaterThan(0);
      for (const i of positions) expect(body.slice(i - '#jeton='.length, i)).toBe('#jeton=');
    }
  });

  it('textes du parcours', () => {
    expect(email.subject).toBe('Réinitialisation de votre mot de passe Toron');
    expect(email.text).toContain('ouvrez ce lien dans les 30 minutes :');
    expect(email.text).toContain('seul le plus récent fonctionne');
    expect(email.text).toContain('la double authentification restera demandée si elle est activée');
    expect(email.text).toContain('Ignorez ce message : votre mot de passe actuel reste valable.');
    expect(email.html).toContain('>Choisir un nouveau mot de passe</a>');
  });
});

describe('mot de passe modifié', () => {
  const { email, link } = renderKind('mot_de_passe_modifie');

  it('date de Paris et lien vers la page de demande', () => {
    expect(email.subject).toBe('Votre mot de passe Toron a été modifié');
    expect(link).toBe(`${ORIGIN}/mot-de-passe/oublie`);
    expect(email.text).toContain('modifié le 10 octobre 2026 à 14\u202fh\u202f32 (heure de Paris).');
    expect(email.text).toContain('Toutes vos sessions ont été fermées');
    expect(email.text).toContain('propriétaire ou le RSSI de votre organisation');
  });

  it('aucun nom, aucune IP', () => {
    expect(email.text).not.toMatch(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/);
    expect(email.text).not.toContain('@');
  });
});

describe('registre des types', () => {
  it('seuls les types de compte passent par la file', () => {
    expect(OUTBOX_EMAIL_KINDS).toEqual(KINDS.filter((k) => EMAIL_KINDS[k].outbox));
    expect(isEmailKind('essai')).toBe(true);
    expect(isEmailKind('toString')).toBe(false);
    expect(isEmailKind('invitation')).toBe(false);
  });

  it('paramètres stricts', () => {
    expect(parseEmailParams('mot_de_passe_reinitialisation', {})).toEqual({});
    expect(parseEmailParams('mot_de_passe_reinitialisation', { lien: 'https://pirate.example' })).toBeNull();
    expect(parseEmailParams('mot_de_passe_modifie', { modifieLe: '2026-10-10T12:32:00Z' })).not.toBeNull();
    expect(parseEmailParams('mot_de_passe_modifie', { modifieLe: '10/10/2026' })).toBeNull();
    expect(parseEmailParams('mot_de_passe_modifie', { modifieLe: NOW.toISOString(), ip: '1.2.3.4' })).toBeNull();
    expect(parseEmailParams('mot_de_passe_modifie', null)).toBeNull();
  });

  it('secret exigé, refusé ou mal formé', () => {
    expect(() => emailLink('mot_de_passe_reinitialisation', ORIGIN, null)).toThrow(/secret/);
    expect(() => emailLink('mot_de_passe_reinitialisation', ORIGIN, 'court')).toThrow(/secret/);
    expect(() => emailLink('mot_de_passe_modifie', ORIGIN, TOKEN)).toThrow(/aucun secret/);
    expect(() => emailLink('essai', 'https://app.toron.eu/chemin', null)).toThrow(/Origine publique invalide/);
  });

  it('refuse un lien qui ne part pas de l’origine publique', () => {
    const params = { modifieLe: NOW.toISOString() };
    expect(() => render('mot_de_passe_modifie', { params, link: 'https://pirate.example/x', origin: ORIGIN, now: NOW }))
      .toThrow(/origine publique/);
    expect(() => render('mot_de_passe_modifie', { params, link: `${ORIGIN}.pirate.example/x`, origin: ORIGIN, now: NOW }))
      .toThrow(/origine publique/);
    expect(() => render('mot_de_passe_modifie', { params, link: `${ORIGIN}/x"onclick=`, origin: ORIGIN, now: NOW }))
      .toThrow(/origine publique/);
  });
});

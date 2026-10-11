import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OutgoingEmail } from '../mailer.ts';
import { createFichierMailer } from './fichier.ts';

const REFERENCE = '0f8b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d';
const EMAIL: OutgoingEmail = {
  reference: REFERENCE,
  to: 'camille.poirier@meridiane-logistics.example',
  subject: 'Réinitialisation de votre mot de passe Toron',
  text: 'Lien : http://localhost:3000/mot-de-passe/nouveau#jeton=JetonDeTest0000000000000',
  html: '<!doctype html><html lang="fr"><title>Réinitialisation</title></html>',
  sendBefore: new Date('2026-10-10T12:30:00.000Z'),
};

let dir = '';
let output: string[] = [];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'toron-courriels-'));
  output = [];
  const capture = (...args: unknown[]) => { output.push(args.map(String).join(' ')); };
  vi.spyOn(console, 'warn').mockImplementation(capture);
  vi.spyOn(console, 'error').mockImplementation(capture);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

describe('transport fichier', () => {
  it('dépose le JSON et le HTML, et ne journalise que la référence', async () => {
    const outcome = await createFichierMailer(join(dir, 'courriels')).send(EMAIL);
    expect(outcome).toEqual({ ok: true, providerMessageId: null });

    const record = JSON.parse(await readFile(join(dir, 'courriels', `${REFERENCE}.json`), 'utf8')) as Record<string, unknown>;
    expect(record).toMatchObject({ reference: REFERENCE, to: EMAIL.to, subject: EMAIL.subject, text: EMAIL.text, html: EMAIL.html });
    expect(await readFile(join(dir, 'courriels', `${REFERENCE}.html`), 'utf8')).toBe(EMAIL.html);

    expect(output).toEqual([`[mail] courriel déposé (fichier) {"outboxId":"${REFERENCE}","transport":"fichier"}`]);
  });

  it.skipIf(process.platform === 'win32')('écrit les fichiers en mode 0600, même réécrits', async () => {
    const mailer = createFichierMailer(dir);
    await writeFile(join(dir, `${REFERENCE}.html`), 'ancien', { mode: 0o644 });
    await mailer.send(EMAIL);
    for (const ext of ['json', 'html']) {
      expect((await stat(join(dir, `${REFERENCE}.${ext}`))).mode & 0o777).toBe(0o600);
    }
  });

  it('refuse une référence qui ne serait pas un UUID', async () => {
    const outcome = await createFichierMailer(dir).send({ ...EMAIL, reference: '../../etc/passwd' });
    expect(outcome).toMatchObject({ ok: false, verdict: { effect: 'definitif' } });
  });

  it('classe un répertoire inutilisable en erreur de configuration', async () => {
    const notADir = join(dir, 'fichier');
    await writeFile(notADir, '');
    const outcome = await createFichierMailer(notADir).send(EMAIL);
    expect(outcome).toMatchObject({ ok: false, verdict: { effect: 'liberation', code: 'CONFIGURATION' } });
    expect(output.join('\n')).not.toContain('@');
  });
});

import 'server-only';

import { connect } from 'node:net';

import { CLAMD_INSTREAM_COMMAND, appError, instreamFrames, parseClamdReply, type AppError, type ScanVerdict } from '@toron/core';
import { withTenant, writeAuditEntry } from '@toron/db';

import { logFailure, type Authorized } from './action-guard';
import { appDb } from './db';
import { env } from './env';

// Analyse antivirus à l'ingestion (PLAN §5.7, V1) : chaque fichier déposé
// passe par clamd avant d'être stocké. Sans réponse « sain », rien n'entre.

export type ScanResult = ScanVerdict | { status: 'desactive' } | { status: 'indisponible'; detail: string };

const SCAN_TIMEOUT_MS = 20_000;

/** Soumet le contenu à clamd (INSTREAM) et rend son verdict. */
export async function scanContent(content: Uint8Array): Promise<ScanResult> {
  const { CLAMAV_URL, ANTIVIRUS_DESACTIVE } = env();
  if (!CLAMAV_URL) {
    return ANTIVIRUS_DESACTIVE === '1' ? { status: 'desactive' } : { status: 'indisponible', detail: 'CLAMAV_URL non configurée' };
  }
  const target = new URL(CLAMAV_URL);
  return new Promise<ScanResult>((resolve) => {
    let settled = false;
    const chunks: Buffer[] = [];
    const socket = connect({ host: target.hostname, port: Number(target.port) });
    const finish = (result: ScanResult) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(SCAN_TIMEOUT_MS, () => finish({ status: 'indisponible', detail: 'délai de réponse dépassé' }));
    socket.on('error', (err: NodeJS.ErrnoException) => finish({ status: 'indisponible', detail: err.code ?? 'erreur réseau' }));
    socket.on('connect', () => {
      socket.write(CLAMD_INSTREAM_COMMAND);
      for (const frame of instreamFrames(content)) socket.write(frame);
    });
    socket.on('data', (data: Buffer) => {
      chunks.push(data);
      // Réponse complète à l'octet nul (commande préfixée « z »).
      if (data.includes(0)) finish(parseClamdReply(Buffer.concat(chunks).toString('utf8')));
    });
    socket.on('end', () => finish(parseClamdReply(Buffer.concat(chunks).toString('utf8'))));
  });
}

/**
 * Barrière d'ingestion : un fichier n'est accepté que si l'antivirus le juge
 * sain (ou si l'analyse est explicitement désactivée en développement). Un
 * fichier infecté est refusé et tracé au journal d'audit — signature,
 * empreinte et nom, jamais le contenu.
 */
export async function antivirusGate(
  auth: Authorized,
  file: { name: string; content: Uint8Array; sha256: string },
): Promise<{ ok: true; antivirus: 'sain' | 'desactive' } | { ok: false; error: AppError }> {
  const result = await scanContent(file.content);
  if (result.status === 'sain' || result.status === 'desactive') return { ok: true, antivirus: result.status };
  if (result.status === 'infecte') {
    await withTenant(appDb().db, auth.tenantId, (tx) => writeAuditEntry(tx, {
      tenantId: auth.tenantId, actorUserId: auth.userId, action: 'upload.malware_blocked', objectType: 'upload',
      after: { fileName: file.name.slice(0, 200), sha256: file.sha256, signature: result.signature },
      ip: auth.ip, userAgent: auth.userAgent,
    }));
    return { ok: false, error: appError('FICHIER_INFECTE', `Fichier refusé : l’antivirus y a détecté « ${result.signature} ». Il n’a pas été enregistré.`) };
  }
  return {
    ok: false,
    error: logFailure(
      new Error(`analyse antivirus impossible : ${result.detail.slice(0, 120)}`),
      appError('ANTIVIRUS_INDISPONIBLE', 'L’analyse antivirus est indisponible : le fichier n’a pas été enregistré. Réessayez dans quelques minutes ; si cela persiste, prévenez votre administrateur.'),
    ),
  };
}

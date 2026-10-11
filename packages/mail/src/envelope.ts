// Scellement du secret d'un e-mail en file (jeton de lien) : AES-256-GCM
// avec une clé dérivée de MAIL_OUTBOX_KEY. L'AAD lie la boîte à sa ligne et
// à son type : recopiée sur une autre ligne, elle ne s'ouvre plus.

import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';

import type { EmailKind } from './kinds.ts';

/** Longueur minimale de MAIL_OUTBOX_KEY, en caractères. */
export const OUTBOX_KEY_MIN_LENGTH = 32;

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
/** Plafond de la contrainte CHECK sur secret_box (migration 0041). */
const MAX_BOX_BYTES = 512;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SealContext {
  id: string;
  kind: EmailKind;
}

export function deriveOutboxKey(secret: string): Buffer {
  if (secret.length < OUTBOX_KEY_MIN_LENGTH) {
    throw new Error(`MAIL_OUTBOX_KEY trop courte : ${OUTBOX_KEY_MIN_LENGTH} caractères au moins.`);
  }
  return Buffer.from(hkdfSync('sha256', secret, 'toron-outbox', 'scellement-v1', KEY_BYTES));
}

/** Identifiant public de la clé, stocké à côté de la boîte : « k » + 8 hex. */
export function keyId(key: Uint8Array): string {
  return `k${createHash('sha256').update(key).digest('hex').slice(0, 8)}`;
}

function aad(context: SealContext): Buffer {
  return Buffer.from(`toron-outbox-v1|${context.id.toLowerCase()}|${context.kind}`, 'utf8');
}

/** iv(12) ‖ chiffré ‖ tag(16). */
export function seal(key: Uint8Array, context: SealContext, plaintext: string): Buffer {
  if (key.length !== KEY_BYTES) throw new Error('Clé de scellement invalide : 32 octets attendus.');
  if (!UUID.test(context.id)) throw new Error('Identifiant de ligne invalide : UUID attendu.');
  const data = Buffer.from(plaintext, 'utf8');
  if (data.length === 0 || data.length > MAX_BOX_BYTES - IV_BYTES - TAG_BYTES) {
    throw new Error('Secret à sceller vide ou trop long.');
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad(context));
  return Buffer.concat([iv, cipher.update(data), cipher.final(), cipher.getAuthTag()]);
}

/**
 * Ouvre une boîte avec la clé désignée par `keyId` parmi `keys` (clé
 * courante, puis précédente pendant une rotation). Null si aucune clé ne
 * correspond, si la boîte a été altérée ou si l'AAD diffère.
 */
export function open(keys: readonly Uint8Array[], context: SealContext & { keyId: string }, box: Uint8Array): string | null {
  const key = keys.find((k) => k.length === KEY_BYTES && keyId(k) === context.keyId);
  if (!key || !UUID.test(context.id) || box.length < IV_BYTES + TAG_BYTES + 1 || box.length > MAX_BOX_BYTES) return null;
  try {
    const iv = box.subarray(0, IV_BYTES);
    const tag = box.subarray(box.length - TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(aad(context));
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(box.subarray(IV_BYTES, box.length - TAG_BYTES)), decipher.final()]);
    return new TextDecoder('utf-8', { fatal: true }).decode(plain);
  } catch {
    return null;
  }
}

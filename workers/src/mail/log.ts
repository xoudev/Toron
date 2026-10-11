// Journal du service mail, à champs fermés : aucune adresse, aucun jeton,
// aucun objet d'erreur ni corps de réponse ne peut y figurer. Les champs
// sont en plus revérifiés à l'exécution, contre un transtypage malheureux.

import { isEmailKind, type EmailKind } from '@toron/mail';

type Level = 'warn' | 'error';

const EVENTS = {
  demarrage_fichier: { level: 'warn', text: 'démarrage · transport fichier — aucun envoi réel' },
  demarrage_scaleway: { level: 'warn', text: 'démarrage · transport Scaleway TEM' },
  suspendu: { level: 'warn', text: 'envoi suspendu (MAIL_ENVOI_SUSPENDU=1) — aucune réclamation' },
  arret: { level: 'warn', text: 'arrêt demandé — fin de l’envoi en cours' },
  arret_force: { level: 'error', text: 'arrêt forcé — envoi en cours abandonné, le bail expirera seul' },
  arrete: { level: 'warn', text: 'arrêté' },
  envoye: { level: 'warn', text: 'courriel envoyé' },
  depose_fichier: { level: 'warn', text: 'courriel déposé (fichier)' },
  reprise: { level: 'warn', text: 'échec transitoire — nouvelle tentative programmée' },
  echec: { level: 'error', text: 'échec définitif' },
  expire: { level: 'warn', text: 'délai dépassé — courriel expiré' },
  liens_expires: { level: 'error', text: 'liens de réinitialisation expirés sans envoi sur la dernière heure' },
  configuration: { level: 'error', text: 'fournisseur ou transport mal configuré — courriel remis en file' },
  libere_arret: { level: 'warn', text: 'arrêt — courriel remis en file sans tentative consommée' },
  bail_perdu: { level: 'error', text: 'bail perdu — clôture ignorée, doublon possible' },
  disjoncteur_ouvert: { level: 'error', text: 'disjoncteur ouvert — réclamations suspendues' },
  disjoncteur_ferme: { level: 'warn', text: 'disjoncteur refermé' },
  disjoncteur_prolonge: { level: 'error', text: 'disjoncteur ouvert depuis plus de 10 minutes' },
  parametres_invalides: { level: 'error', text: 'paramètres non conformes au type — courriel abandonné' },
  secret_illisible: { level: 'error', text: 'secret illisible ou mal formé — courriel abandonné' },
  destinataire_refuse: { level: 'warn', text: 'destinataire refusé par la garde — courriel abandonné' },
  rendu_impossible: { level: 'error', text: 'rendu impossible — courriel abandonné' },
  purge: { level: 'warn', text: 'purge de la file' },
  synthese: { level: 'warn', text: 'synthèse de la file' },
  file_en_retard: { level: 'error', text: 'courriel en attente depuis plus de 5 minutes' },
  erreur_base: { level: 'error', text: 'erreur de base de données' },
  erreur_battement: { level: 'error', text: 'battement de cœur non écrit' },
} as const satisfies Record<string, { level: Level; text: string }>;

export type MailEvent = keyof typeof EVENTS;

export interface MailLogFields {
  outboxId?: string;
  correlationId?: string;
  kind?: EmailKind;
  /** Code machine : last_error_code, SQLSTATE ou errno. */
  code?: string;
  attempts?: number;
  backlog?: number;
  echecs?: number;
  expirations?: number;
  purgees?: number;
  secondes?: number;
  httpStatus?: number;
  transport?: 'scaleway' | 'fichier' | 'memoire';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE = /^[A-Z][A-Z0-9_]{1,39}$/;
const TRANSPORTS = ['scaleway', 'fichier', 'memoire'] as const;

function count(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) ? Math.round(value) : undefined;
}

function clean(fields: MailLogFields): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  if (fields.outboxId !== undefined) out['outboxId'] = UUID.test(fields.outboxId) ? fields.outboxId : 'invalide';
  if (fields.correlationId !== undefined) {
    out['correlationId'] = UUID.test(fields.correlationId) ? fields.correlationId : 'invalide';
  }
  if (fields.kind !== undefined) out['kind'] = isEmailKind(fields.kind) ? fields.kind : 'inconnu';
  if (fields.code !== undefined) out['code'] = CODE.test(fields.code) ? fields.code : 'INCONNU';
  if (fields.transport !== undefined) {
    out['transport'] = (TRANSPORTS as readonly string[]).includes(fields.transport) ? fields.transport : 'inconnu';
  }
  for (const key of ['attempts', 'backlog', 'echecs', 'expirations', 'purgees', 'secondes', 'httpStatus'] as const) {
    const n = count(fields[key]);
    if (n !== undefined) out[key] = n;
  }
  return out;
}

export function logMail(event: MailEvent, fields: MailLogFields = {}): void {
  const spec = EVENTS[event];
  const payload = clean(fields);
  const line = Object.keys(payload).length === 0
    ? `[mail] ${spec.text}`
    : `[mail] ${spec.text} ${JSON.stringify(payload)}`;
  if (spec.level === 'error') console.error(line);
  else console.warn(line);
}

/**
 * Code machine d'une erreur : SQLSTATE de Postgres (éventuellement enveloppé
 * par Drizzle dans `cause`), code errno ou code du pilote. Jamais le message,
 * qui peut citer une valeur de la requête.
 */
export function errorCode(err: unknown): string {
  let current: unknown = err;
  for (let depth = 0; depth < 4 && typeof current === 'object' && current !== null; depth++) {
    const code: unknown = (current as { code?: unknown }).code;
    if (typeof code === 'string') {
      if (/^[0-9A-Z]{5}$/.test(code) && /[0-9]/.test(code)) return `SQLSTATE_${code}`;
      if (CODE.test(code)) return code;
    }
    current = (current as { cause?: unknown }).cause;
  }
  if (typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'TimeoutError') return 'DELAI';
  return 'INCONNU';
}

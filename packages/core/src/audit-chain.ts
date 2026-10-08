/**
 * Chaînage du journal d'audit (plan §8.2) : lecture du résultat d'une
 * vérification. La base recalcule les empreintes ; ici on décide seulement
 * de ce qu'on en dit à l'utilisateur, sans promettre plus que ce qui a été
 * vérifié.
 */

export interface AuditChainCheck {
  /** Entrées présentes et numéro de la dernière. */
  entries: number;
  lastSeq: number;
  /** Dernier numéro attribué selon la tête de chaîne tenue par la base. */
  headSeq: number;
  /** Première entrée dont le chaînage ne se vérifie pas, ou null. */
  brokenAtSeq: number | null;
}

export interface AuditChainVerdict {
  intact: boolean;
  title: string;
  detail: string;
}

const fr = (n: number): string => n.toLocaleString('fr-FR');

export function auditChainVerdict(c: AuditChainCheck): AuditChainVerdict {
  if (c.brokenAtSeq === null) {
    if (c.entries === 0) {
      return { intact: true, title: 'Journal vide', detail: 'Aucune entrée à vérifier pour l’instant.' };
    }
    return {
      intact: true,
      title: 'Chaîne intègre',
      detail: `${fr(c.entries)} entrée${c.entries > 1 ? 's' : ''} vérifiée${c.entries > 1 ? 's' : ''}, `
        + `de la n° 1 à la n° ${fr(c.lastSeq)} : aucune n’a été modifiée, insérée ni supprimée.`,
    };
  }
  const advice = 'Exportez le journal en l’état pour l’enquête et prévenez le responsable de la sécurité.';
  if (c.brokenAtSeq > c.lastSeq) {
    const missing = c.headSeq - c.lastSeq;
    const what = missing > 1
      ? `les entrées n° ${fr(c.lastSeq + 1)} à ${fr(c.headSeq)} ont été effacées`
      : `l’entrée n° ${fr(c.headSeq)} a été effacée`;
    return {
      intact: false,
      title: 'Rupture détectée en fin de journal',
      detail: (missing > 0
        ? `La base a numéroté ${fr(c.headSeq)} entrées, il n’en reste que ${fr(c.entries)} : ${what} hors de l’application. `
        : `La dernière entrée (n° ${fr(c.lastSeq)}) ne correspond plus à la tête de chaîne tenue par la base : elle a été remplacée hors de l’application. `)
        + advice,
    };
  }
  return {
    intact: false,
    title: `Rupture détectée à l’entrée n° ${fr(c.brokenAtSeq)}`,
    detail: `Cette entrée, ou celle qui la précédait, a été modifiée, insérée ou supprimée hors de l’application. `
      + (c.brokenAtSeq > 1 ? `Les entrées n° 1 à ${fr(c.brokenAtSeq - 1)} restent cohérentes entre elles. ` : '')
      + advice,
  };
}

// Accusés de lecture : avancement d'une campagne de lecture obligatoire.

export interface AcknowledgementProgress {
  acknowledged: number;
  total: number;
  /** Pourcentage arrondi, null si personne n'est concerné. */
  pct: number | null;
  complete: boolean;
}

export function acknowledgementProgress(acknowledged: number, total: number): AcknowledgementProgress {
  const a = Math.max(0, Math.min(acknowledged, total));
  return { acknowledged: a, total, pct: total === 0 ? null : Math.round((a / total) * 100), complete: total > 0 && a >= total };
}

/**
 * Une lecture est attendue d'un membre quand le document l'exige, qu'une
 * version est publiée et que ce membre ne l'a pas encore acceptée.
 */
export function acknowledgementExpected(input: { required: boolean; publishedVersionId: string | null; acknowledgedByMe: boolean }): boolean {
  return input.required && input.publishedVersionId !== null && !input.acknowledgedByMe;
}

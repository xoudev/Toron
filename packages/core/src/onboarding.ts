// Mise en route d'une organisation : étapes dérivées des données réelles.
// Une organisation vide ne doit jamais lire « tout est à jour » ; elle doit
// voir ce qui reste à faire pour que le tableau de bord ait du sens.

export interface OnboardingInput {
  scopes: number;
  frameworksActive: number;
  members: number;
  controls: number;
  risks: number;
  assessments: number;
  evidences: number;
  documents: number;
}

export type OnboardingStepKey =
  | 'perimetre' | 'referentiel' | 'equipe' | 'existant' | 'controles' | 'evaluation' | 'preuves';

export interface OnboardingStep {
  key: OnboardingStepKey;
  title: string;
  detail: string;
  /** Chemin relatif à la racine de l'organisation (/t/[slug]). */
  path: string;
  cta: string;
  done: boolean;
}

export function onboardingSteps(i: OnboardingInput): OnboardingStep[] {
  return [
    {
      key: 'perimetre', title: 'Délimiter le périmètre',
      detail: 'Entités, sites et nature du système de management couverts.',
      path: '/parametres?section=perimetres', cta: 'Configurer', done: i.scopes > 0,
    },
    {
      key: 'referentiel', title: 'Activer un référentiel',
      detail: 'ISO 27001, NIS 2 (ReCyF), ISO 9001, RGPD… ou votre référentiel interne.',
      path: '/referentiels', cta: 'Choisir', done: i.frameworksActive > 0,
    },
    {
      key: 'equipe', title: 'Inviter l’équipe',
      detail: 'Direction, pilotes, contributeurs : chacun avec le rôle qui lui revient.',
      path: '/parametres?section=membres', cta: 'Inviter', done: i.members > 1,
    },
    {
      key: 'existant', title: 'Reprendre l’existant',
      detail: 'Importez vos registres Excel (risques, actions, actifs, fournisseurs) ou saisissez vos premiers risques.',
      path: '/import', cta: 'Importer', done: i.risks > 0,
    },
    {
      key: 'controles', title: 'Décrire vos contrôles',
      detail: 'Partez des contrôles types, déjà rattachés à ISO 27001, NIS 2 et au RGPD, puis adaptez-les : une preuve servira plusieurs référentiels.',
      path: '/controles', cta: 'Démarrer', done: i.controls > 0,
    },
    {
      key: 'evaluation', title: 'Lancer une première évaluation',
      detail: 'Statut exigence par exigence, écarts et déclaration d’applicabilité.',
      path: '/referentiels', cta: 'Évaluer', done: i.assessments > 0,
    },
    {
      key: 'preuves', title: 'Constituer le dossier de preuves',
      detail: 'Politiques publiées et preuves datées, avec leur échéance de renouvellement.',
      path: '/preuves', cta: 'Déposer', done: i.evidences > 0 || i.documents > 0,
    },
  ];
}

export function onboardingProgress(steps: readonly OnboardingStep[]): { done: number; total: number; complete: boolean } {
  const done = steps.filter((s) => s.done).length;
  return { done, total: steps.length, complete: done === steps.length };
}

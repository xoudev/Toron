// Mise en route d'une organisation : étapes dérivées des données réelles.
// Une organisation vide ne doit jamais lire « tout est à jour » ; elle doit
// voir ce qui reste à faire pour que le tableau de bord ait du sens.

export interface OnboardingInput {
  scopes: number;
  /** Entités juridiques : indispensables à la qualification NIS 2. */
  entities: number;
  frameworksActive: number;
  members: number;
  /** Contrôles actifs : seuls ils cochent l'étape. */
  controlsActive: number;
  /** Brouillons repris des contrôles types : restent à adapter, ne cochent rien. */
  controlsDraft: number;
  risks: number;
  actions: number;
  assets: number;
  assessments: number;
  evidences: number;
  /** Documents dotés d'une version publiée : un brouillon n'est pas opposable. */
  documentsPublished: number;
  /** Référentiel actif où lancer la première évaluation (sa page porte la campagne). */
  firstActiveFrameworkId?: string | null;
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
  // Des contrôles types repris mais pas encore adaptés : l'étape le dit.
  const draftsOnly = i.controlsActive === 0 && i.controlsDraft > 0;
  return [
    {
      // Un périmètre naît avec l'organisation : c'est l'entité juridique qui manque.
      key: 'perimetre', title: 'Délimiter le périmètre',
      detail: 'Votre société (entité juridique), ses sites et la nature du système de management. L’entité est nécessaire à la qualification NIS 2.',
      path: '/parametres?section=organisation', cta: 'Configurer', done: i.scopes > 0 && i.entities > 0,
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
      detail: 'Importez vos registres Excel (risques, actions, actifs) ou saisissez vos premiers risques.',
      path: '/import', cta: 'Importer', done: i.risks + i.actions + i.assets > 0,
    },
    {
      key: 'controles', title: 'Décrire vos contrôles',
      detail: draftsOnly
        ? `${i.controlsDraft} en brouillon à adapter, puis à activer : seuls les contrôles actifs comptent.`
        : 'Partez des contrôles types, déjà rattachés à ISO 27001, NIS 2 et au RGPD, puis adaptez-les : une preuve servira plusieurs référentiels.',
      path: '/controles', cta: draftsOnly ? 'Adapter' : 'Démarrer', done: i.controlsActive > 0,
    },
    {
      // La campagne se lance depuis la page d'un référentiel actif, pas du catalogue.
      key: 'evaluation', title: 'Lancer une première évaluation',
      detail: i.firstActiveFrameworkId
        ? 'Statut exigence par exigence, écarts et déclaration d’applicabilité.'
        : 'Activez d’abord un référentiel : l’évaluation se lance depuis sa page.',
      path: i.firstActiveFrameworkId ? `/referentiels/${i.firstActiveFrameworkId}` : '/referentiels',
      cta: 'Évaluer', done: i.assessments > 0,
    },
    {
      key: 'preuves', title: 'Constituer le dossier de preuves',
      detail: 'Politiques publiées et preuves datées, avec leur échéance de renouvellement.',
      path: '/preuves', cta: 'Déposer', done: i.evidences > 0 || i.documentsPublished > 0,
    },
  ];
}

export function onboardingProgress(steps: readonly OnboardingStep[]): { done: number; total: number; complete: boolean } {
  const done = steps.filter((s) => s.done).length;
  return { done, total: steps.length, complete: done === steps.length };
}

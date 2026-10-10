import { describe, expect, it } from 'vitest';

import { onboardingProgress, onboardingSteps } from './onboarding.ts';

const empty = {
  scopes: 0, entities: 0, frameworksActive: 0, members: 1, controlsActive: 0, controlsDraft: 0, risks: 0, actions: 0,
  assets: 0, assessments: 0, evidences: 0, documentsPublished: 0,
};
const step = (input: typeof empty & { firstActiveFrameworkId?: string | null }, key: string) =>
  onboardingSteps(input).find((s) => s.key === key)!;

describe('mise en route', () => {
  it('une organisation neuve n’a rien de terminé hormis ce qui existe réellement', () => {
    const steps = onboardingSteps({ ...empty, scopes: 1, entities: 1 });
    expect(steps.filter((s) => s.done).map((s) => s.key)).toEqual(['perimetre']);
    expect(onboardingProgress(steps)).toEqual({ done: 1, total: 7, complete: false });
  });
  it('le périmètre créé avec l’organisation ne suffit pas sans entité juridique', () => {
    expect(step({ ...empty, scopes: 1 }, 'perimetre').done).toBe(false);
    expect(step({ ...empty, scopes: 1 }, 'perimetre').path).toBe('/parametres?section=organisation');
  });
  it('l’équipe n’est constituée qu’au-delà du seul créateur', () => {
    expect(step(empty, 'equipe').done).toBe(false);
    expect(step({ ...empty, members: 2 }, 'equipe').done).toBe(true);
  });
  it('l’existant est repris dès qu’un registre importable contient une ligne', () => {
    expect(step(empty, 'existant').done).toBe(false);
    expect(step({ ...empty, actions: 4 }, 'existant').done).toBe(true);
    expect(step({ ...empty, assets: 12 }, 'existant').done).toBe(true);
    expect(step({ ...empty, risks: 1 }, 'existant').done).toBe(true);
  });
  it('les contrôles ne comptent qu’une fois actifs', () => {
    expect(step(empty, 'controles').done).toBe(false);
    const drafts = step({ ...empty, controlsDraft: 40 }, 'controles');
    expect(drafts.done).toBe(false);
    expect(drafts.detail).toMatch(/^40 en brouillon à adapter/);
    expect(drafts.cta).toBe('Adapter');
    expect(step({ ...empty, controlsActive: 1, controlsDraft: 40 }, 'controles').done).toBe(true);
  });
  it('l’évaluation mène au référentiel actif, sinon au catalogue pour en activer un', () => {
    const id = '0b5c8a1e-6f3d-4c2a-9e7b-1d2f3a4b5c6d';
    expect(step({ ...empty, firstActiveFrameworkId: id }, 'evaluation').path).toBe(`/referentiels/${id}`);
    const none = step({ ...empty, firstActiveFrameworkId: null }, 'evaluation');
    expect(none.path).toBe('/referentiels');
    expect(none.detail).toMatch(/Activez d’abord un référentiel/);
  });
  it('le dossier de preuves compte aussi les documents publiés', () => {
    expect(step({ ...empty, documentsPublished: 1 }, 'preuves').done).toBe(true);
  });
  it('une organisation outillée est complète', () => {
    const full = {
      scopes: 2, entities: 1, frameworksActive: 2, members: 3, controlsActive: 3, controlsDraft: 0, risks: 5, actions: 2,
      assets: 4, assessments: 1, evidences: 3, documentsPublished: 2,
    };
    expect(onboardingProgress(onboardingSteps(full)).complete).toBe(true);
  });
  it('chaque étape mène à un écran interne de l’organisation', () => {
    for (const s of onboardingSteps(empty)) expect(s.path.startsWith('/')).toBe(true);
  });
});

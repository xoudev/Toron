import { describe, expect, it } from 'vitest';

import { onboardingProgress, onboardingSteps } from './onboarding.ts';

const empty = { scopes: 0, frameworksActive: 0, members: 1, controls: 0, risks: 0, assessments: 0, evidences: 0, documents: 0 };

describe('mise en route', () => {
  it('une organisation neuve n’a rien de terminé hormis ce qui existe réellement', () => {
    const steps = onboardingSteps({ ...empty, scopes: 1 });
    expect(steps.filter((s) => s.done).map((s) => s.key)).toEqual(['perimetre']);
    expect(onboardingProgress(steps)).toEqual({ done: 1, total: 7, complete: false });
  });
  it('l’équipe n’est constituée qu’au-delà du seul créateur', () => {
    expect(onboardingSteps(empty).find((s) => s.key === 'equipe')!.done).toBe(false);
    expect(onboardingSteps({ ...empty, members: 2 }).find((s) => s.key === 'equipe')!.done).toBe(true);
  });
  it('le dossier de preuves compte aussi les documents publiés', () => {
    expect(onboardingSteps({ ...empty, documents: 1 }).find((s) => s.key === 'preuves')!.done).toBe(true);
  });
  it('une organisation outillée est complète', () => {
    const full = { scopes: 2, frameworksActive: 2, members: 3, controls: 3, risks: 5, assessments: 1, evidences: 3, documents: 2 };
    expect(onboardingProgress(onboardingSteps(full)).complete).toBe(true);
  });
  it('chaque étape mène à un écran interne de l’organisation', () => {
    for (const s of onboardingSteps(empty)) expect(s.path.startsWith('/')).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';

import {
  SUPPLIER_QUESTIONS,
  assessSupplier,
  attestationFreshness,
  supplierCorrectiveDefaults,
  supplierQuestion,
  nextAssessmentDue,
  supplierAssessmentState,
  supplierNeedsAttention,
  type SupplierAnswers,
} from './suppliers.ts';

function all(answer: 'oui' | 'partiel' | 'non' | 'na'): SupplierAnswers {
  return Object.fromEntries(SUPPLIER_QUESTIONS.map((q) => [q.key, answer]));
}

describe('évaluation fournisseur', () => {
  it('refuse un questionnaire incomplet en listant les questions manquantes', () => {
    const answers = all('oui');
    delete answers.mfa;
    expect(assessSupplier(answers, 't2')).toEqual({ ok: false, reason: 'incomplet', missing: ['mfa'] });
  });

  it('refuse un questionnaire entièrement sans objet', () => {
    expect(assessSupplier(all('na'), 't3')).toMatchObject({ ok: false, reason: 'sans_objet' });
  });

  it('note sur 100, pondérée, en excluant les réponses sans objet', () => {
    expect(assessSupplier(all('oui'), 't1')).toMatchObject({ ok: true, score: 100, rating: 'satisfaisant', gaps: [] });
    expect(assessSupplier(all('partiel'), 't2')).toMatchObject({ ok: true, score: 50, rating: 'sous_reserve' });
    const answers = { ...all('oui'), rgpd: 'na' as const, reversibilite: 'non' as const };
    // 19 points possibles une fois le RGPD exclu, 1 perdu : 18/19.
    expect(assessSupplier(answers, 't2')).toMatchObject({ ok: true, score: 95, rating: 'satisfaisant', gaps: ['reversibilite'] });
  });

  it('un point bloquant manquant rend un fournisseur critique insuffisant, pas les autres', () => {
    const answers = { ...all('oui'), incidents: 'non' as const };
    expect(assessSupplier(answers, 't1')).toMatchObject({ ok: true, rating: 'insuffisant', blocking: ['incidents'] });
    expect(assessSupplier(answers, 't2')).toMatchObject({ ok: true, rating: 'satisfaisant', blocking: [] });
  });

  it('propose les écarts « non » avant les « partiel »', () => {
    const answers = { ...all('oui'), gouvernance: 'partiel' as const, audit: 'non' as const };
    expect(assessSupplier(answers, 't3')).toMatchObject({ gaps: ['audit', 'gouvernance'] });
  });

  it('chaque question porte une action corrective et un poids de 1 à 3', () => {
    for (const q of SUPPLIER_QUESTIONS) {
      expect(q.correctiveAction.length).toBeGreaterThan(10);
      expect(q.weight).toBeGreaterThanOrEqual(1);
      expect(q.weight).toBeLessThanOrEqual(3);
    }
  });
});

describe('cycle de réévaluation', () => {
  it('annuelle pour T1, tous les deux ans pour T2, trois ans pour T3', () => {
    expect(nextAssessmentDue('t1', '2026-03-12')).toBe('2027-03-12');
    expect(nextAssessmentDue('t2', '2026-03-12')).toBe('2028-03-12');
    expect(nextAssessmentDue('t3', '2026-03-12')).toBe('2029-03-12');
    expect(nextAssessmentDue('t1', '2024-02-29')).toBe('2025-02-28');
  });

  it('distingue jamais évalué, à jour et à refaire', () => {
    expect(supplierAssessmentState('t1', null, '2026-10-06')).toBe('jamais');
    expect(supplierAssessmentState('t1', '2026-03-12', '2026-10-06')).toBe('a_jour');
    expect(supplierAssessmentState('t1', '2025-06-20', '2026-10-06')).toBe('a_refaire');
    expect(supplierAssessmentState('t2', '2025-06-20', '2026-10-06')).toBe('a_jour');
  });
});

describe('attestations et priorités', () => {
  it('applique la fenêtre de 30 jours des preuves', () => {
    expect(attestationFreshness('2026-09-15', '2026-10-06')).toBe('expiree');
    expect(attestationFreshness('2026-10-28', '2026-10-06')).toBe('bientot');
    expect(attestationFreshness('2027-03-31', '2026-10-06')).toBe('fraiche');
    expect(attestationFreshness(null, '2026-10-06')).toBe('permanente');
  });

  it('signale les critiques sans évaluation à jour et les fournisseurs jugés insuffisants', () => {
    const ok = { assessment: 'a_jour' as const, insufficient: false, expiredAttestation: false };
    expect(supplierNeedsAttention('t1', ok)).toBe(false);
    expect(supplierNeedsAttention('t1', { ...ok, assessment: 'jamais' })).toBe(true);
    expect(supplierNeedsAttention('t2', { ...ok, assessment: 'jamais' })).toBe(false);
    expect(supplierNeedsAttention('t2', { ...ok, insufficient: true })).toBe(true);
    expect(supplierNeedsAttention('t3', { ...ok, expiredAttestation: true })).toBe(false);
  });
});

describe('actions correctives fournisseur', () => {
  it('P1 sous 30 jours pour un point bloquant chez un critique, P2 sous 90 jours sinon', () => {
    const incidents = supplierQuestion('incidents')!;
    const audit = supplierQuestion('audit')!;
    expect(supplierCorrectiveDefaults(incidents, 't1', '2026-10-06')).toEqual({ priority: 'p1', dueDate: '2026-11-05' });
    expect(supplierCorrectiveDefaults(incidents, 't2', '2026-10-06')).toEqual({ priority: 'p2', dueDate: '2027-01-04' });
    expect(supplierCorrectiveDefaults(audit, 't1', '2026-10-06')).toEqual({ priority: 'p2', dueDate: '2027-01-04' });
  });
});

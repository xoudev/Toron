import { describe, expect, it } from 'vitest';

import { defaultDisabledModules, isModuleEnabled, moduleForSegment, normalizeDisabledModules, workKindEnabled } from './modules.ts';

describe('modules activables', () => {
  it('propose des modules adaptés à la nature du périmètre', () => {
    expect(defaultDisabledModules('mixte')).toEqual([]);
    expect(defaultDisabledModules('smsi')).toEqual(['processus', 'non_conformites']);
    expect(defaultDisabledModules('qms')).toEqual(['ebios', 'incidents', 'actifs']);
  });
  it('ignore les valeurs inconnues et désactive EBIOS RM avec le registre des risques', () => {
    expect(normalizeDisabledModules(['audits', 'inconnu', 'audits'])).toEqual(['audits']);
    expect(normalizeDisabledModules(['risques'])).toEqual(['risques', 'ebios']);
  });
  it('répond par module et par segment de chemin', () => {
    expect(isModuleEnabled(['audits'], 'audits')).toBe(false);
    expect(isModuleEnabled(['audits'], 'risques')).toBe(true);
    expect(moduleForSegment('revue-direction')).toBe('revue_direction');
    expect(moduleForSegment('documents')).toBeNull();
  });
});

describe('filtrage par module', () => {
  it('masque les éléments des modules désactivés et garde le socle', () => {
    expect(workKindEnabled('risque', ['risques'])).toBe(false);
    expect(workKindEnabled('action', ['risques'])).toBe(true);
    expect(workKindEnabled('revue', ['revue_direction'])).toBe(false);
    expect(workKindEnabled('preuve', ['audits'])).toBe(true);
    expect(workKindEnabled('derogation', ['derogations'])).toBe(false);
    expect(moduleForSegment('derogations')).toBe('derogations');
    expect(workKindEnabled('formation', ['sensibilisation'])).toBe(false);
    expect(moduleForSegment('sensibilisation')).toBe('sensibilisation');
    expect(workKindEnabled('continuite', ['continuite'])).toBe(false);
    expect(moduleForSegment('continuite')).toBe('continuite');
  });
});

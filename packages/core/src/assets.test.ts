import { describe, expect, it } from 'vitest';

import { assetSensitivity, isDicpAxisValid, parseAssetsCsv } from './assets.ts';

describe('DICP', () => {
  it('valide un axe entre 1 et 4', () => {
    expect(isDicpAxisValid(1)).toBe(true);
    expect(isDicpAxisValid(4)).toBe(true);
    expect(isDicpAxisValid(0)).toBe(false);
    expect(isDicpAxisValid(5)).toBe(false);
    expect(isDicpAxisValid(2.5)).toBe(false);
  });

  it('sensibilité = max des axes', () => {
    expect(assetSensitivity({ d: 2, i: 3, c: 4, p: 1 })).toBe(4);
    expect(assetSensitivity({ d: 1, i: 1, c: 1, p: 1 })).toBe(1);
  });
});

describe('parseAssetsCsv', () => {
  it('analyse un CSV valide avec alias FR et séparateur ;', () => {
    const csv = [
      'nom;catégorie;description;d;i;c;p',
      'Serveur WMS;Matériel;Serveur applicatif logistique;4;3;3;2',
      'Base clients;données;PII clients;3;4;4;3',
    ].join('\n');
    const res = parseAssetsCsv(csv);
    expect(res.errors).toHaveLength(0);
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0]).toMatchObject({ name: 'Serveur WMS', category: 'materiel' });
    expect(res.rows[1]!.category).toBe('donnees');
    expect(res.rows[1]!.dicp).toEqual({ d: 3, i: 4, c: 4, p: 3 });
  });

  it('remonte les erreurs ligne par ligne sans planter', () => {
    const csv = [
      'name,category,d',
      'Sans catégorie,inconnue,2',
      ',materiel,1',
      'Cotation folle,logiciel,9',
      'Ok,flux,',
    ].join('\n');
    const res = parseAssetsCsv(csv);
    // Seule « Ok » (flux, DICP défaut 1) est valide.
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]!.name).toBe('Ok');
    expect(res.errors).toHaveLength(3);
  });

  it('rejette un en-tête sans colonnes obligatoires', () => {
    expect(parseAssetsCsv('foo,bar\n1,2').errors[0]).toMatch(/En-tête invalide/);
    expect(parseAssetsCsv('').errors[0]).toMatch(/vide/);
  });
});

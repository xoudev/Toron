import { describe, expect, it } from 'vitest';

import { csvTemplate, detectMapping, IMPORT_TARGETS, parseDelimited, validateRows } from './import.ts';

describe('détection des colonnes', () => {
  it('mappe les en-têtes FR (avec accents) vers les champs, avec confiance', () => {
    const headers = ['Intitulé', 'Gravité brute', 'Vraisemblance brute', 'Gravité nette', 'Vraisemblance nette', 'Traitement'];
    const map = detectMapping(headers, 'risk');
    const byField = Object.fromEntries(map.map((m) => [m.field, m]));
    expect(byField.title!.columnIndex).toBe(0);
    expect(byField.title!.confidence).toBe(1);
    expect(byField.grossG!.columnIndex).toBe(1);
    expect(byField.treatment!.columnIndex).toBe(5);
  });

  it('laisse columnIndex null si aucune colonne ne correspond', () => {
    const map = detectMapping(['a', 'b'], 'asset');
    expect(map.find((m) => m.field === 'name')!.columnIndex).toBeNull();
    expect(map.find((m) => m.field === 'name')!.confidence).toBe(0);
  });
});

describe('modèle CSV téléchargeable', () => {
  it('chaque modèle est reconnu à 100 % et sa ligne d’exemple est valide', () => {
    for (const target of IMPORT_TARGETS) {
      const table = parseDelimited(csvTemplate(target));
      const mapping = detectMapping(table.headers, target);
      // Tous les champs requis sont détectés avec pleine confiance.
      const requiredUnmatched = mapping.filter((m) => m.columnIndex === null);
      expect(requiredUnmatched, `cible ${target}`).toHaveLength(0);
      const res = validateRows(table.rows, target, mapping);
      expect(res.rejected, `cible ${target}`).toHaveLength(0);
      expect(res.rows.length).toBe(1);
    }
  });
});

describe('validation ligne à ligne (RM §5.13 : jamais d’échec silencieux)', () => {
  it('accepte les lignes valides et rejette les autres avec cause + correction', () => {
    const headers = ['name', 'category', 'd', 'i', 'c', 'p'];
    const map = detectMapping(headers, 'asset');
    const data = [
      ['Serveur WMS', 'Matériel', '4', '3', '3', '2'],
      ['', 'logiciel', '1', '1', '1', '1'], // nom manquant
      ['Cotation folle', 'donnees', '9', '1', '1', '1'], // DICP hors 1-4
      ['Catégorie inconnue', 'bidon', '1', '1', '1', '1'], // enum invalide
      ['Base clients', 'données', '3', '4', '4', '3'],
    ];
    const res = validateRows(data, 'asset', map);
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0]).toMatchObject({ name: 'Serveur WMS', category: 'materiel', dicpD: 4 });
    expect(res.rejected).toHaveLength(3);
    // La numérotation de ligne tient compte de l'en-tête (ligne 3 = 2e donnée).
    expect(res.rejected[0]!.line).toBe(3);
    expect(res.rejected[0]!.cause).toMatch(/Intitulé.*manquant/);
    expect(res.rejected[1]!.cause).toMatch(/9.*invalide/);
    expect(res.rejected[1]!.suggestion).toMatch(/entre 1 et 4/);
    expect(res.rejected[2]!.suggestion).toMatch(/valeurs admises/);
  });

  it('détecte une date impossible (31/02) et propose la correction', () => {
    const headers = ['titre', 'echeance'];
    const map = detectMapping(headers, 'action');
    const res = validateRows([['Revue des accès', '31/02/2026']], 'action', map);
    expect(res.rows).toHaveLength(0);
    expect(res.rejected[0]!.cause).toMatch(/31\/02\/2026.*invalide/);
    expect(res.rejected[0]!.suggestion).toMatch(/corriger la date/);
  });

  it('normalise les dates FR et ISO', () => {
    const map = detectMapping(['titre', 'echeance'], 'action');
    const res = validateRows([['A', '05/09/2026'], ['B', '2026-09-05']], 'action', map);
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0]!.dueDate).toBe('2026-09-05');
    expect(res.rows[1]!.dueDate).toBe('2026-09-05');
  });

  it('ignore les lignes entièrement vides sans les compter comme rejets', () => {
    const map = detectMapping(['nom', 'categorie'], 'asset');
    const res = validateRows([['', ''], ['Actif', 'flux']], 'asset', map);
    expect(res.rows).toHaveLength(1);
    expect(res.rejected).toHaveLength(0);
  });
});

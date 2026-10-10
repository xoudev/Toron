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

describe('lecture du fichier délimité', () => {
  it('garde dans la cellule un saut de ligne entre guillemets (Alt+Entrée sous Excel)', () => {
    const text = 'Intitulé;Scénario;G\r\n"Rançongiciel";"Hameçonnage\r\npuis chiffrement";4\r\nFuite;"Vol ""interne""\nd’un portable";2\r\n';
    const t = parseDelimited(text);
    expect(t.headers).toEqual(['Intitulé', 'Scénario', 'G']);
    expect(t.rows).toEqual([
      ['Rançongiciel', 'Hameçonnage\npuis chiffrement', '4'],
      ['Fuite', 'Vol "interne"\nd’un portable', '2'],
    ]);
  });

  it('numérote les rejets selon les lignes du classeur malgré une cellule multiligne', () => {
    const text = [
      'Intitulé;Scénario;Gravité brute;Vraisemblance brute;Gravité nette;Vraisemblance nette',
      'A;"ligne 1\nligne 2";3;3;2;2',
      'B;ok;;3;2;2',
    ].join('\n');
    const t = parseDelimited(text);
    expect(t.rows).toHaveLength(2);
    const res = validateRows(t.rows, 'risk', detectMapping(t.headers, 'risk'));
    expect(res.rows).toHaveLength(1);
    expect(res.rejected[0]!.line).toBe(3);
    expect(res.rejected[0]!.cause).toMatch(/Gravité brute.*manquant/);
  });

  it('un guillemet au milieu d’une cellule reste littéral', () => {
    const t = parseDelimited('nom;categorie\nÉcran 24";materiel\nPoste;materiel\n');
    expect(t.rows).toEqual([['Écran 24"', 'materiel'], ['Poste', 'materiel']]);
    expect(t.unclosedQuoteAt).toBeUndefined();
  });

  it('signale la ligne d’un guillemet jamais refermé au lieu d’avaler la suite en silence', () => {
    const text = [
      'Intitulé;Scénario;Gravité brute;Vraisemblance brute;Gravité nette;Vraisemblance nette',
      'Z;"ligne 1\r\nligne 2";3;3;2;2',
      'A;"Projet X en retard;3;3;2;2',
      'B;ok;3;3;2;2',
      'C;ok;3;3;2;2',
    ].join('\r\n');
    // Ligne 4 du fichier : la cellule multiligne de la ligne 2 en occupe deux.
    expect(parseDelimited(text).unclosedQuoteAt).toBe(4);
  });

  it('ignore les lignes vides et retire le BOM', () => {
    const t = parseDelimited('﻿nom,categorie\n\nServeur,materiel\n\n');
    expect(t.headers).toEqual(['nom', 'categorie']);
    expect(t.rows).toEqual([['Serveur', 'materiel']]);
  });
});

describe('cotations de risque bornées par l’échelle active', () => {
  const headers = ['Intitulé', 'Gravité brute', 'Vraisemblance brute', 'Gravité nette', 'Vraisemblance nette'];
  const map = detectMapping(headers, 'risk');

  it('rejette tout le fichier coté sur 5 niveaux quand l’échelle est en 4×4 (défaut), pas seulement les lignes à 5', () => {
    const res = validateRows([['Rançongiciel', '5', '3', '4', '2'], ['Panne', '4', '4', '2', '1'], ['', '', '', '', '']], 'risk', map);
    expect(res.rows).toHaveLength(0);
    // La ligne à 4 (« Élevée » sur 5) n'est pas importée comme « Critique » sur 4.
    expect(res.rejected.map((r) => r.line)).toEqual([2, 3]);
    expect(res.rejected[1]!.cause).toMatch(/au moins 5 niveaux.*en compte 4/);
    expect(res.rejected[1]!.suggestion).toMatch(/toutes les cotations du fichier sur 4 niveaux/);
  });

  it('suit la taille de l’échelle du tenant', () => {
    const rows = [['Rançongiciel', '5', '3', '4', '2']];
    expect(validateRows(rows, 'risk', map, { riskScaleSize: 5 }).rows).toHaveLength(1);
    const res = validateRows(rows, 'risk', map, { riskScaleSize: 3 });
    expect(res.rejected[0]!.suggestion).toMatch(/sur 3 niveaux/);
  });

  it('garde le rejet ligne à ligne pour une cotation nulle ou non entière', () => {
    const res = validateRows([['Rançongiciel', '0', '3', '4', '2'], ['Panne', '4', '4', '2', '1']], 'risk', map);
    expect(res.rows).toHaveLength(1);
    expect(res.rejected[0]!.cause).toMatch(/Gravité brute.*0.*invalide/);
    expect(res.rejected[0]!.suggestion).toMatch(/entre 1 et 4/);
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

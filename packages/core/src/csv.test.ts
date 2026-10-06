import { describe, expect, it } from 'vitest';

import { csvCell, csvFileName, toCsv } from './csv.ts';

describe('export CSV', () => {
  it('neutralise les formules saisies par un utilisateur', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell('+33 6')).toBe(`"'+33 6"`);
    expect(csvCell('@SUM(A1)')).toBe(`"'@SUM(A1)"`);
    expect(csvCell('-1')).toBe(`"'-1"`);
  });
  it('n’altère pas les nombres, dates et booléens produits par l’application', () => {
    expect(csvCell(-3)).toBe('"-3"');
    expect(csvCell(true)).toBe('"oui"');
    expect(csvCell(null)).toBe('""');
    expect(csvCell(new Date('2026-10-06T08:00:00Z'))).toBe('"2026-10-06T08:00:00.000Z"');
  });
  it('produit un fichier lisible par Excel en français', () => {
    const csv = toCsv([{ header: 'Titre', value: (r: { t: string }) => r.t }, { header: 'Note', value: () => 'a;b' }], [{ t: 'Risque « fuite »' }]);
    expect(csv.startsWith('﻿"Titre";"Note"\r\n')).toBe(true);
    expect(csv).toContain('"Risque « fuite »";"a;b"');
  });
  it('construit un nom de fichier sans caractère risqué', () => {
    expect(csvFileName(['Registre des risques', 'Méridiane/../x'], '2026-10-06')).toBe('registre-des-risques-meridiane-x-2026-10-06.csv');
  });
});

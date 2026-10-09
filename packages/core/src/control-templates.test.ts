import { describe, expect, it } from 'vitest';

import { templateCoveragePreview } from './control-templates.ts';

const iso = { code: 'iso27001', version: '2022', name: 'ISO/IEC 27001:2022', leafCount: 118, coveredRefs: ['A.5.1'] };
const recyf = { code: 'recyf', version: 'v2.5', name: 'ReCyF', leafCount: 152, coveredRefs: [] };

describe('templateCoveragePreview', () => {
  it('ajoute aux exigences déjà outillées celles des modèles choisis, sans double compte', () => {
    const preview = templateCoveragePreview([iso, recyf], [
      { mappings: [{ framework: 'iso27001', version: '2022', refs: ['A.5.1', '5.2'] }, { framework: 'recyf', version: 'v2.5', refs: ['2.B.1-EI/EE'] }] },
      { mappings: [{ framework: 'iso27001', version: '2022', refs: ['5.2', 'A.5.2'] }] },
    ]);
    expect(preview).toEqual([
      { code: 'iso27001', name: 'ISO/IEC 27001:2022', leafCount: 118, before: 1, after: 3 },
      { code: 'recyf', name: 'ReCyF', leafCount: 152, before: 0, after: 1 },
    ]);
  });

  it('ignore une autre version du même référentiel', () => {
    const [p] = templateCoveragePreview([iso], [{ mappings: [{ framework: 'iso27001', version: '2013', refs: ['A.9.1'] }] }]);
    expect(p).toMatchObject({ before: 1, after: 1 });
  });

  it('sans modèle choisi, l’aperçu reprend l’état actuel', () => {
    expect(templateCoveragePreview([recyf], [])).toEqual([{ code: 'recyf', name: 'ReCyF', leafCount: 152, before: 0, after: 0 }]);
  });
});

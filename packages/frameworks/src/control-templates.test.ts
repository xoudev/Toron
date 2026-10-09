import { describe, expect, it } from 'vitest';

import { FRAMEWORK_CATALOG } from './catalog.ts';
import { CONTROL_TEMPLATE_DOMAINS, CONTROL_TEMPLATE_FRAMEWORKS, controlTemplates } from './control-templates.ts';
import { iso27001 } from './iso27001.ts';
import { recyf } from './recyf.ts';

const templates = controlTemplates();
const refsOf = (framework: string) => new Set(templates.flatMap((t) => t.mappings.filter((m) => m.framework === framework).flatMap((m) => m.refs)));

describe('contrôles types', () => {
  it('clés uniques, domaines connus, textes renseignés', () => {
    const keys = templates.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    const domains = new Set<string>(CONTROL_TEMPLATE_DOMAINS.map((d) => d.key));
    for (const t of templates) {
      expect(domains.has(t.domain), t.key).toBe(true);
      expect(t.key.startsWith(`${t.domain}.`), t.key).toBe(true);
      expect(t.title.length, t.key).toBeLessThanOrEqual(120);
      expect(t.description.length, t.key).toBeGreaterThan(40);
      expect(t.evidence.length, t.key).toBeGreaterThan(10);
      expect(t.mappings.length, t.key).toBeGreaterThan(0);
    }
    // Chaque domaine porte au moins un contrôle.
    for (const d of CONTROL_TEMPLATE_DOMAINS) expect(templates.some((t) => t.domain === d.key), d.key).toBe(true);
  });

  it('chaque référence ISO 27001 existe, et toute l’Annexe A et les clauses 4 à 10 sont couvertes', () => {
    const data = iso27001();
    const known = new Set([
      ...data.clauses.flatMap((c) => c.children.map((ch) => ch.ref)),
      ...data.themes.flatMap((t) => t.controls.map((c) => c.ref)),
    ]);
    const used = refsOf('iso27001');
    for (const ref of used) expect(known.has(ref), ref).toBe(true);
    expect([...known].filter((ref) => !used.has(ref))).toEqual([]);
  });

  it('chaque moyen ReCyF existe, et les 152 moyens sont couverts', () => {
    const known = new Set(recyf().objectives.flatMap((o) => o.means.map((m) => m.ref)));
    const used = refsOf('recyf');
    for (const ref of used) expect(known.has(ref), ref).toBe(true);
    expect(known.size).toBe(152);
    expect([...known].filter((ref) => !used.has(ref))).toEqual([]);
  });

  it('les références des autres référentiels intégrés existent dans le catalogue, à la bonne version', () => {
    for (const t of templates) {
      for (const m of t.mappings) {
        if (m.framework === 'iso27001' || m.framework === 'recyf') continue;
        const fw = FRAMEWORK_CATALOG.find((f) => f.code === m.framework);
        expect(fw, `${t.key} → ${m.framework}`).toBeDefined();
        expect(fw!.version, m.framework).toBe(CONTROL_TEMPLATE_FRAMEWORKS[m.framework]);
        const refs = new Set(fw!.requirements.map((r) => r.ref));
        for (const ref of m.refs) expect(refs.has(ref), `${t.key} → ${m.framework} ${ref}`).toBe(true);
      }
    }
  });

  it('versions alignées sur les données intégrées', () => {
    expect(CONTROL_TEMPLATE_FRAMEWORKS.iso27001).toBe(iso27001().version);
    expect(CONTROL_TEMPLATE_FRAMEWORKS.recyf).toBe(recyf().version);
  });
});

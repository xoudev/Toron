/**
 * Contrôles types (module 5.2) : aperçu de ce que leur reprise apporte à
 * chaque référentiel activé, avant de créer quoi que ce soit.
 */

export interface TemplateCoverageFramework {
  code: string;
  version: string;
  name: string;
  /** Exigences feuilles du référentiel, et celles déjà dotées d'un contrôle. */
  leafCount: number;
  coveredRefs: readonly string[];
}

export interface TemplateMappingLike {
  framework: string;
  version: string;
  refs: readonly string[];
}

export interface TemplateCoveragePreview {
  code: string;
  name: string;
  leafCount: number;
  /** Exigences outillées aujourd'hui, puis après reprise des modèles choisis. */
  before: number;
  after: number;
}

export function templateCoveragePreview(
  frameworks: readonly TemplateCoverageFramework[],
  selected: readonly { mappings: readonly TemplateMappingLike[] }[],
): TemplateCoveragePreview[] {
  return frameworks.map((f) => {
    const covered = new Set(f.coveredRefs);
    const before = covered.size;
    for (const t of selected) {
      for (const m of t.mappings) {
        if (m.framework === f.code && m.version === f.version) for (const ref of m.refs) covered.add(ref);
      }
    }
    return { code: f.code, name: f.name, leafCount: f.leafCount, before, after: Math.min(covered.size, f.leafCount) };
  });
}

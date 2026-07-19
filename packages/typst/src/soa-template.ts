import type { SoaModel } from './soa-model.ts';

// Échappe une chaîne pour un littéral Typst ("..."). On neutralise \ et ",
// et on aplatit les sauts de ligne — les données (intitulés reformulés,
// justifications) sont ainsi injectées sans risque d'injection de balisage.
function ts(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ')}"`;
}

// Insère une chaîne comme TEXTE en mode markup (échappe la syntaxe, rend sans
// guillemets). ts() sert au tableau #let data (mode code) ; mk() aux
// insertions markup (en-tête, pied, cellules de méta).
function mk(s: string): string {
  return s.replace(/[\r\n]+/g, ' ').replace(/[\\#[\]*_`$<>@~]/g, (c) => `\\${c}`);
}

const STATUS_COLOR: Record<string, string> = {
  Conforme: 'rgb("#2e7d4f")',
  Écart: 'rgb("#b23327")',
  'Non applicable': 'rgb("#8b908c")',
  'À évaluer': 'rgb("#946200")',
};

/**
 * Génère la source Typst de la Déclaration d'applicabilité. Le rendu est
 * déterministe ; le pied de page porte le poinçon (slug + URL de
 * vérification) — l'empreinte SHA-256 complète est sur la page /verifier
 * (elle ne peut figurer dans le PDF qu'elle scelle, ADR-6).
 */
export function renderSoaTypst(model: SoaModel): string {
  const rows = model.rows
    .map(
      (r) =>
        `  (${ts(r.ref)}, ${ts(r.title)}, ${ts(r.status)}, ${ts(
          r.included ? 'Oui' : 'Non',
        )}, ${ts(r.justification ?? '')}),`,
    )
    .join('\n');

  const coverage = model.coveragePct === null ? '—' : `${model.coveragePct} %`;

  return `#set document(title: "Déclaration d'applicabilité", author: "Toron")
#set page(
  paper: "a4",
  margin: (x: 2.2cm, y: 2.4cm),
  footer: context [
    #set text(size: 7pt, fill: rgb("#7a7c73"))
    #line(length: 100%, stroke: 0.5pt + rgb("#e2e0d8"))
    #v(4pt)
    #grid(
      columns: (1fr, auto),
      [Document scellé par Toron · poinçon ${mk(model.verifySlug)}],
      [Vérifier l'intégrité : ${mk(model.verifyUrl)} · page #counter(page).display() / #context counter(page).final().first()],
    )
  ],
)
#set text(size: 10pt, font: "New Computer Modern")

#grid(
  columns: (1fr, auto),
  [
    #text(size: 15pt, weight: "bold")[toron]
    #v(-4pt)
    #text(size: 8pt, fill: rgb("#7a7c73"))[Conformité & gestion des risques]
  ],
  align(right)[
    #box(inset: (x: 6pt, y: 3pt), stroke: 0.5pt + rgb("#d9d7cf"), radius: 2pt)[
      #text(size: 7pt, fill: rgb("#8b8a82"))[CONFIDENTIEL · DIFFUSION RESTREINTE]
    ]
  ],
)

#v(18pt)
#text(size: 19pt, weight: "bold")[Déclaration d'applicabilité]
#v(2pt)
#text(size: 11pt, fill: rgb("#5b5d56"))[${mk(model.frameworkName)}]

#v(10pt)
#table(
  columns: (auto, 1fr),
  stroke: none,
  inset: (x: 0pt, y: 2pt),
  text(fill: rgb("#7a7c73"))[Entité], [${mk(model.entityName)}],
  text(fill: rgb("#7a7c73"))[Périmètre], [${mk(model.scopeName)}],
  text(fill: rgb("#7a7c73"))[Généré le], [${mk(model.generatedAtLabel)}],
  text(fill: rgb("#7a7c73"))[Couverture], [${mk(coverage)} · ${model.gaps} écart(s)],
)

#v(14pt)
#line(length: 100%, stroke: 0.5pt + rgb("#e2e0d8"))
#v(10pt)

#let data = (
${rows}
)

#let statusCell(s) = {
  let colors = (
    "Conforme": ${STATUS_COLOR['Conforme']},
    "Écart": ${STATUS_COLOR['Écart']},
    "Non applicable": ${STATUS_COLOR['Non applicable']},
    "À évaluer": ${STATUS_COLOR['À évaluer']},
  )
  text(fill: colors.at(s, default: rgb("#5b5d56")))[#s]
}

#table(
  columns: (auto, 1fr, auto, auto, 1.4fr),
  align: (left, left, left, center, left),
  inset: 6pt,
  stroke: 0.5pt + rgb("#e2e0d8"),
  fill: (_, row) => if row == 0 { rgb("#f7f7f6") } else { white },
  table.header(
    text(weight: "bold", size: 8pt)[Réf.],
    text(weight: "bold", size: 8pt)[Exigence],
    text(weight: "bold", size: 8pt)[Statut],
    text(weight: "bold", size: 8pt)[Incluse],
    text(weight: "bold", size: 8pt)[Justification d'exclusion],
  ),
  ..data.map(r => (
    text(size: 8pt, font: "DejaVu Sans Mono")[#r.at(0)],
    text(size: 8pt)[#r.at(1)],
    text(size: 8pt)[#statusCell(r.at(2))],
    text(size: 8pt)[#r.at(3)],
    text(size: 8pt, fill: rgb("#5b5d56"))[#r.at(4)],
  )).flatten()
)
`;
}

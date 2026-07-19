import type { EbiosModel } from './ebios-model.ts';

function ts(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ')}"`;
}

/**
 * Génère la source Typst du livrable EBIOS RM. Rendu déterministe ; le pied
 * de page porte le poinçon (slug + URL de vérification). L'empreinte SHA-256
 * complète est sur la page /verifier (ADR-6).
 */
export function renderEbiosTypst(model: EbiosModel): string {
  const scenarios = model.scenarios
    .map((sc) => {
      const phases = sc.phases
        .map((p) => {
          const acts = p.actions
            .map((a) => `      text(size: 8pt, fill: rgb("#5b5d56"))[• ${a.tech ? `#text(fill: rgb("#cb4e0a"), font: "DejaVu Sans Mono")[${ts(a.tech)}] ` : ''}#box[${ts(a.label)}]],`)
            .join('\n');
          return `    block(above: 5pt)[
      #text(size: 8.5pt, weight: "bold")[${ts(p.label)}]
      #v(1pt)
      #stack(spacing: 2pt,
${acts || '        text(size: 8pt, fill: rgb("#8b8a82"))[—],'}
      )
    ]`;
        })
        .join('\n');
      return `  block(breakable: false, above: 12pt)[
    #text(size: 11pt, weight: "bold")[${ts(sc.riskSource)} #text(fill: rgb("#7a7c73"))[→] ${ts(sc.targetObjective)}]
    #h(6pt) #box(inset: (x: 5pt, y: 2pt), fill: rgb("#f2efe9"), radius: 2pt)[#text(size: 8pt)[${ts('Vraisemblance ' + sc.likelihoodLabel)}]]
    ${sc.generated ? '#h(4pt) #text(size: 8pt, fill: rgb("#2e7d4f"))[· versé au registre]' : ''}
    #v(3pt)
${phases}
  ]`;
    })
    .join('\n');

  return `#set document(title: "Livrable EBIOS RM", author: "Toron")
#set page(
  paper: "a4",
  margin: (x: 2.2cm, y: 2.4cm),
  footer: context [
    #set text(size: 7pt, fill: rgb("#7a7c73"))
    #line(length: 100%, stroke: 0.5pt + rgb("#e2e0d8"))
    #v(4pt)
    #grid(
      columns: (1fr, auto),
      [Document scellé par Toron · ${ts('poinçon ' + model.verifySlug)}],
      [Vérifier l'intégrité : ${ts(model.verifyUrl)} · page #counter(page).display() / #context counter(page).final().first()],
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
#text(size: 19pt, weight: "bold")[Livrable EBIOS RM]
#v(2pt)
#text(size: 11pt, fill: rgb("#5b5d56"))[${ts(model.title)}]
#v(1pt)
#text(size: 9pt, fill: rgb("#8b8a82"))[Méthode ANSSI · scénarios opérationnels]

#v(10pt)
#table(
  columns: (auto, 1fr),
  stroke: none,
  inset: (x: 0pt, y: 2pt),
  text(fill: rgb("#7a7c73"))[Entité], [${ts(model.entityName)}],
  text(fill: rgb("#7a7c73"))[Périmètre], [${ts(model.scopeLabel)}],
  text(fill: rgb("#7a7c73"))[Avancement], [${ts(model.workshopLabel)}],
  text(fill: rgb("#7a7c73"))[Généré le], [${ts(model.generatedAtLabel)}],
)

#v(14pt)
#line(length: 100%, stroke: 0.5pt + rgb("#e2e0d8"))
#v(6pt)
#text(size: 12pt, weight: "bold")[Scénarios opérationnels]

${scenarios || '#v(8pt)\n#text(size: 9pt, fill: rgb("#8b8a82"))[Aucun scénario opérationnel.]'}
`;
}

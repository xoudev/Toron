import type { PvModel } from './pv-model.ts';

// Insère une chaîne comme TEXTE en mode markup Typst (échappe la syntaxe, rend
// le texte sans guillemets). À ne pas confondre avec un littéral chaîne mode
// code « "..." ».
function mk(s: string): string {
  return s.replace(/[\r\n]+/g, ' ').replace(/[\\#[\]*_`$<>@~]/g, (c) => `\\${c}`);
}

/**
 * Génère la source Typst du procès-verbal de revue de direction. Rendu
 * déterministe ; le pied de page porte le poinçon (slug + URL de
 * vérification). L'empreinte SHA-256 complète est sur la page /verifier
 * (elle ne peut figurer dans le PDF qu'elle scelle, ADR-6).
 */
export function renderPvTypst(model: PvModel): string {
  const agenda = model.agenda
    .map((s) => {
      const lines =
        s.lines.length === 0
          ? '  #text(size: 9pt, fill: rgb("#8b8a82"))[—]'
          : s.lines.map((l) => `  #text(size: 9pt, fill: rgb("#5b5d56"))[• ${mk(l)}]`).join('\\\n');
      return `#block(breakable: false, above: 10pt)[
  #text(size: 8pt, fill: rgb("#8b8a82"), font: "DejaVu Sans Mono")[${mk(s.clause)}]\\
  #text(size: 10.5pt, weight: "bold")[${s.n}. ${mk(s.title)}]\\
${lines}
]`;
    })
    .join('\n');

  const decisions =
    model.decisions.length === 0
      ? '#text(size: 9pt, fill: rgb("#8b8a82"))[Aucune décision consignée.]'
      : model.decisions
          .map(
            (d, i) => `#block(above: 6pt)[
  #text(size: 9.5pt)[#text(weight: "bold")[D${i + 1}.] ${mk(d.body)}]${
            d.actionNote ? `\\\n  #text(size: 8pt, fill: rgb("#2e7d4f"))[→ ${mk(d.actionNote)}]` : ''
          }
]`,
          )
          .join('\n');

  const participants = model.participants.length === 0 ? '—' : model.participants.join(', ');

  return `#set document(title: "Procès-verbal de revue de direction", author: "Toron")
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
#text(size: 19pt, weight: "bold")[Procès-verbal de revue de direction]
#v(2pt)
#text(size: 11pt, fill: rgb("#5b5d56"))[${mk(model.title)}]
#v(1pt)
#text(size: 9pt, fill: rgb("#8b8a82"))[Clause 9.3 · 27001 & 9001 · une seule revue]

#v(10pt)
#table(
  columns: (auto, 1fr),
  stroke: none,
  inset: (x: 0pt, y: 2pt),
  text(fill: rgb("#7a7c73"))[Entité], [${mk(model.entityName)}],
  text(fill: rgb("#7a7c73"))[Périmètre], [${mk(model.scopeLabel)}],
  text(fill: rgb("#7a7c73"))[Séance du], [${mk(model.heldAtLabel)}],
  text(fill: rgb("#7a7c73"))[Participants], [${mk(participants)}],
  text(fill: rgb("#7a7c73"))[Généré le], [${mk(model.generatedAtLabel)}],
)

#v(14pt)
#line(length: 100%, stroke: 0.5pt + rgb("#e2e0d8"))
#v(6pt)
#text(size: 12pt, weight: "bold")[Ordre du jour — entrées de la clause 9.3.2]
#v(4pt)

${agenda}

#v(14pt)
#line(length: 100%, stroke: 0.5pt + rgb("#e2e0d8"))
#v(6pt)
#text(size: 12pt, weight: "bold")[Décisions (sorties 9.3.3)]
#v(4pt)

${decisions}

${model.nextReviewLabel ? `#v(14pt)\n#text(size: 9pt, fill: rgb("#5b5d56"))[Prochaine revue prévue le ${mk(model.nextReviewLabel)}.]` : ''}
`;
}

import type { BoardModel } from './board-model.ts';
import { typstText as mk } from './escape.ts';

const TONE: Record<BoardModel['messages'][number]['tone'], { label: string; color: string }> = {
  alerte: { label: 'ALERTE', color: '#b3261e' },
  vigilance: { label: 'VIGILANCE', color: '#946200' },
  positif: { label: 'POINT POSITIF', color: '#2e7d4f' },
};

function section(title: string, body: string): string {
  // Titre « collant » : jamais seul en bas de page, toujours avec son contenu.
  return `#block(sticky: true, above: 12pt)[
  #line(length: 100%, stroke: 0.5pt + rgb("#e2e0d8"))
  #v(4pt)
  #text(size: 12pt, weight: "bold")[${mk(title)}]
]
#v(4pt)
${body}`;
}

function muted(text: string): string {
  return `#text(size: 9pt, fill: rgb("#8b8a82"))[${mk(text)}]`;
}

function table(headers: string[], rows: string[][], columns: string): string {
  const head = headers.map((h) => `text(size: 8pt, fill: rgb("#7a7c73"))[${mk(h)}]`).join(', ');
  const body = rows.map((r) => r.map((c) => `[${mk(c)}]`).join(', ')).join(',\n  ');
  return `#table(
  columns: ${columns},
  stroke: (x, y) => if y == 0 { (bottom: 0.5pt + rgb("#d9d7cf")) } else { (bottom: 0.3pt + rgb("#ecebe5")) },
  inset: (x: 4pt, y: 4pt),
  ${head},
  ${body}
)`;
}

/**
 * Source Typst du rapport de direction. Rendu déterministe ; le pied de page
 * porte le poinçon (slug + URL de vérification), l'empreinte complète est sur
 * la page /verifier (ADR-6).
 */
export function renderBoardTypst(m: BoardModel): string {
  const messages = m.messages.length === 0
    ? muted('Pas assez de données pour dégager des messages.')
    : m.messages.map((x) => `#block(above: 5pt)[#box(width: 78pt)[#text(size: 7.5pt, weight: "bold", fill: rgb("${TONE[x.tone].color}"))[${TONE[x.tone].label}]] #text(size: 10pt)[${mk(x.text)}]]`).join('\n');
  const decisions = m.decisions.length === 0
    ? muted('Aucun arbitrage en attente.')
    : m.decisions.map((d, i) => `#block(above: 5pt)[#text(size: 10pt)[#text(weight: "bold")[${i + 1}.] ${mk(d)}]]`).join('\n');
  const kpis = `#grid(
  columns: (1fr, 1fr, 1fr),
  row-gutter: 10pt,
  ${m.kpis.map((k) => `[#text(size: 8pt, fill: rgb("#7a7c73"))[${mk(k.label)}]\\ #text(size: 15pt, weight: "bold")[${mk(k.value)}]]`).join(',\n  ')}
)`;
  const nis2 = m.nis2.length === 0 ? muted('Aucune entité qualifiée.') : m.nis2.map((n) => `#block(above: 5pt)[#text(size: 10pt, weight: "bold")[${mk(n.title)}]\\ #text(size: 9pt, fill: rgb("#5b5d56"))[${mk(n.detail)}]]`).join('\n');
  const frameworks = m.frameworks.length === 0 ? muted('Aucune évaluation lancée.') : m.frameworks.map((f) => `#text(size: 10pt)[• ${mk(f)}]`).join('\\\n');
  const risks = m.risks === null ? null : m.risks.length === 0
    ? muted(m.riskRegisterEmpty ? 'Aucun risque enregistré — registre à constituer.' : 'Aucun risque élevé ou critique après traitement.')
    : table(['Réf.', 'Risque', 'Niveau net', 'Traitement', 'Responsable'], m.risks.map((r) => [r.ref, r.title, r.level, r.treatment, r.owner]), '(auto, 1fr, auto, auto, auto)');
  const actions = m.overdueActions.length === 0
    ? muted('Aucune action en retard.')
    : table(['Réf.', 'Action', 'Priorité', 'Échéance', 'Responsable'], m.overdueActions.map((a) => [a.ref, a.title, a.priority, a.due, a.owner]), '(auto, 1fr, auto, auto, auto)');

  return `#set document(title: "Rapport de direction", author: "Toron")
#set page(
  paper: "a4",
  margin: (x: 2.2cm, y: 2.4cm),
  footer: context [
    #set text(size: 7pt, fill: rgb("#7a7c73"))
    #line(length: 100%, stroke: 0.5pt + rgb("#e2e0d8"))
    #v(4pt)
    #grid(
      columns: (1fr, auto),
      [Document scellé par Toron · poinçon ${mk(m.verifySlug)}],
      [Vérifier l'intégrité : ${mk(m.verifyUrl)} · page #counter(page).display() / #context counter(page).final().first()],
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
#text(size: 19pt, weight: "bold")[Rapport de direction]
#v(2pt)
#text(size: 11pt, fill: rgb("#5b5d56"))[${mk(m.organisationName)}]
#v(1pt)
#text(size: 9pt, fill: rgb("#8b8a82"))[${mk(m.headline)} · situation au ${mk(m.situationLabel)} · généré le ${mk(m.generatedAtLabel)}]

${section('Messages clés', messages)}
${section('Décisions attendues de la direction', decisions)}
${section('Indicateurs', kpis)}
${section('NIS 2 et obligations', nis2)}
${section('Conformité par référentiel', frameworks)}
${risks === null ? '' : section('Risques principaux', risks)}
${section('Actions en retard', actions)}

#v(14pt)
${muted('Établi à partir des registres de Toron. Les qualifications NIS 2 sont indicatives ; l’enregistrement auprès de l’ANSSI fait foi.')}
`;
}

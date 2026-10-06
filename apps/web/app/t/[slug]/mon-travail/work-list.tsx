'use client';

import {
  WORK_KINDS, WORK_KIND_META, WORK_URGENCY_LABEL, dueLabel, type WorkGroup, type WorkKind, type WorkUrgency,
} from '@toron/core';
import { useMemo, useState } from 'react';

import { frDate } from '@/lib/format';

// Une action ou une non-conformité sans échéance est un manque à corriger ;
// un processus ou un contrôle n'en porte pas par nature.
const DATED_KINDS: ReadonlySet<WorkKind> = new Set(['action', 'nc', 'incident', 'audit']);

const TONE: Record<WorkUrgency, string> = {
  en_retard: 'danger',
  cette_semaine: 'warn',
  ce_mois: 'neutral',
  plus_tard: 'neutral',
  sans_echeance: 'muted',
};

export function WorkList({ slug, today, groups, total }: { slug: string; today: string; groups: WorkGroup[]; total: number }) {
  const [kind, setKind] = useState<WorkKind | null>(null);

  const counts = useMemo(() => {
    const c = new Map<WorkKind, number>();
    for (const g of groups) for (const i of g.items) c.set(i.kind, (c.get(i.kind) ?? 0) + 1);
    return c;
  }, [groups]);

  const shown = kind
    ? groups.map((g) => ({ ...g, items: g.items.filter((i) => i.kind === kind) })).filter((g) => g.items.length > 0)
    : groups;

  if (total === 0) {
    return (
      <div className="empty-state">
        <h2>Rien ne vous est assigné pour l’instant</h2>
        <p>
          Dès qu’on vous confie une action, un risque à revoir, une preuve à renouveler, un incident ou un document à lire,
          il apparaît ici avec son échéance. Les responsables affectent les éléments depuis chaque module.
        </p>
        <a className="btn btn-ghost btn-sm" href={`/t/${slug}/plan-action`}>Voir le plan d’action</a>
      </div>
    );
  }

  return (
    <>
      <div className="work-filters" role="group" aria-label="Filtrer par module">
        <button type="button" className="work-filter" aria-pressed={kind === null} onClick={() => setKind(null)}>
          Tout <span className="mono">{total}</span>
        </button>
        {WORK_KINDS.filter((k) => counts.has(k)).map((k) => (
          <button key={k} type="button" className="work-filter" aria-pressed={kind === k} onClick={() => setKind(k)}>
            {WORK_KIND_META[k].plural} <span className="mono">{counts.get(k)}</span>
          </button>
        ))}
      </div>

      {shown.map((g) => (
        <section key={g.urgency} className="work-group" aria-labelledby={`work-${g.urgency}`}>
          <h2 id={`work-${g.urgency}`} className={`work-group-title tone--${TONE[g.urgency]}`}>
            {WORK_URGENCY_LABEL[g.urgency]} <span className="mono">{g.items.length}</span>
          </h2>
          <ul className="card work-items">
            {g.items.map((i) => (
              <li key={`${i.kind}-${i.id}`}>
                <a href={`/t/${slug}${WORK_KIND_META[i.kind].path}?ouvrir=${i.id}`}>
                  <span className="ds-chip">{WORK_KIND_META[i.kind].label}</span>
                  <span className="work-title">
                    <b>{i.title}</b>
                    <small>{i.detail}</small>
                  </span>
                  {i.due ? (
                    <span className={`work-due tone--${TONE[g.urgency]}`}>
                      {dueLabel(i.due, today)}
                      <small className="mono">{frDate(i.due)}</small>
                    </span>
                  ) : DATED_KINDS.has(i.kind) ? (
                    <span className="work-due">Échéance à fixer</span>
                  ) : <span />}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

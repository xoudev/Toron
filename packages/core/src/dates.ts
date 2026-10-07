// Calendrier des échéances métier : dates civiles AAAA-MM-JJ, sans fuseau.

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

/** AAAA-MM-JJ + n mois, le jour ramené au dernier jour du mois au besoin (comme Postgres). */
export function addMonthsIso(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const total = y! * 12 + (m! - 1) + months;
  const year = Math.floor(total / 12);
  const month = total - year * 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return `${pad(year, 4)}-${pad(month + 1)}-${pad(Math.min(d!, lastDay))}`;
}

/** AAAA-MM-JJ + n jours. */
export function addDaysIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const t = new Date(Date.UTC(y!, m! - 1, d! + days));
  return `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

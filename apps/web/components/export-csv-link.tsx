/** Lien de téléchargement du registre courant au format CSV (Excel). */
export function ExportCsvLink({ slug, registre, label = 'Exporter (CSV)' }: { slug: string; registre: string; label?: string }) {
  return (
    <a className="btn btn-ghost btn-sm export-csv" href={`/t/${slug}/registres/${registre}/csv`} download title={label}>
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 4v11 M7.5 10.5 12 15l4.5-4.5 M5 19.5h14" />
      </svg>
      <span className="export-csv-label">{label}</span>
    </a>
  );
}

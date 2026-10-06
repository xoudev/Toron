import { MODULE_META, canConfigureOrganisation, type MembershipRole, type OptionalModule } from '@toron/core';
import { ThemeToggle, Topbar } from '@toron/ui';

/** Écran affiché à la place d'un module masqué pour l'organisation. */
export function ModuleDisabled({ slug, module, role }: { slug: string; module: OptionalModule; role: MembershipRole }) {
  const meta = MODULE_META[module];
  return (
    <>
      <Topbar crumbRoot="Module masqué" crumbCurrent={meta.label} actions={<ThemeToggle />} />
      <main className="app-page">
        <div className="empty-state">
          <h2>{meta.label} n’est pas activé pour cette organisation</h2>
          <p>{meta.description}</p>
          <p>Les données éventuellement saisies sont conservées et réapparaissent dès la réactivation.</p>
          {canConfigureOrganisation(role) ? (
            <a className="btn btn-primary btn-sm" href={`/t/${slug}/parametres?section=modules`}>Gérer les modules</a>
          ) : (
            <p className="ds-muted">Demandez à la direction, au RSSI ou au responsable qualité de l’activer.</p>
          )}
        </div>
      </main>
    </>
  );
}

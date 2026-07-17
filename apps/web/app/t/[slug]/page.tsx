import { getTenantContext } from '@/lib/tenant-context-cache';

export const dynamic = 'force-dynamic';

export default async function TenantAccueilPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const ctx = await getTenantContext(slug);

  // non_connecte est redirigé par le layout.
  if (ctx.verdict === 'refuse' || ctx.verdict === 'non_connecte') {
    return (
      <main className="auth-page">
        <div className="auth-card">
          <h1>Accès refusé</h1>
          <p>
            Cette organisation n’existe pas ou vous n’en êtes pas membre — vérifiez l’adresse, ou
            demandez une invitation à son administrateur.
          </p>
          <p className="auth-alt">
            <a href="/organisations">Retour à vos organisations</a>
          </p>
        </div>
      </main>
    );
  }

  if (ctx.verdict === 'totp_requis') {
    return (
      <main className="auth-page">
        <div className="auth-card">
          <h1>{ctx.tenantName}</h1>
          <p>
            Votre rôle exige la double authentification (TOTP) — activez-la pour accéder à cette
            organisation.
          </p>
          <p className="auth-alt">
            <a href="/securite/2fa">Activer la double authentification</a>
          </p>
        </div>
      </main>
    );
  }

  return (
    <>
      <h1 style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-0.01em' }}>Tableau de bord</h1>
      <p style={{ color: 'var(--text-2)', fontSize: '12.5px', marginTop: 2 }}>
        Phase M0 — fondations. Les indicateurs, la couverture par référentiel et le plan d’action
        arrivent avec la phase MVP.
      </p>
    </>
  );
}

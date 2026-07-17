import { redirect } from 'next/navigation';

import { resolveTenantContext } from '@/lib/tenant-context';

export const dynamic = 'force-dynamic';

export default async function TenantAccueilPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const ctx = await resolveTenantContext(slug);

  if (ctx.verdict === 'non_connecte') redirect('/connexion');

  if (ctx.verdict === 'refuse') {
    return (
      <main>
        <h1>Accès refusé</h1>
        <p>
          Cette organisation n’existe pas ou vous n’en êtes pas membre — vérifiez l’adresse, ou
          demandez une invitation à son administrateur.
        </p>
        <p>
          <a href="/organisations">Retour à vos organisations</a>
        </p>
      </main>
    );
  }

  if (ctx.verdict === 'totp_requis') {
    return (
      <main>
        <h1>{ctx.tenantName}</h1>
        <p>
          Votre rôle exige la double authentification (TOTP) — activez-la pour accéder à cette
          organisation.
        </p>
        <p>
          <a href="/securite/2fa">Activer la double authentification</a>
        </p>
      </main>
    );
  }

  return (
    <main>
      <h1>{ctx.tenantName}</h1>
      <p>
        Connecté — rôle : {ctx.role}. Le tableau de bord arrive avec la phase MVP ; le shell UI
        (M0-5) habillera cette page.
      </p>
    </main>
  );
}

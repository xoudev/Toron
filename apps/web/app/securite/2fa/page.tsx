import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { auth } from '@/lib/auth';
import { safeInternalPath } from '@/lib/safe-path';

import { Activation2fa } from './activation-2fa';

export const dynamic = 'force-dynamic';

/**
 * L'activation du TOTP exige une session ouverte : sinon, connexion puis retour
 * ici. `suite` (chemin interne validé) indique où reprendre une fois activé.
 */
export default async function Activation2faPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = (await searchParams)['suite'];
  const retour = safeInternalPath(typeof raw === 'string' ? raw : null);
  const ici = retour === '/organisations' ? '/securite/2fa' : `/securite/2fa?suite=${encodeURIComponent(retour)}`;
  const session = await auth().api.getSession({ headers: await headers() });
  if (!session) redirect(`/connexion?suite=${encodeURIComponent(ici)}`);
  return <Activation2fa suite={ici} retour={retour} />;
}

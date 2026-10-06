import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { auth } from '@/lib/auth';

import { Activation2fa } from './activation-2fa';

export const dynamic = 'force-dynamic';

const SUITE = '/securite/2fa';

/** L'activation du TOTP exige une session ouverte : sinon, connexion puis retour ici. */
export default async function Activation2faPage() {
  const session = await auth().api.getSession({ headers: await headers() });
  if (!session) redirect(`/connexion?suite=${encodeURIComponent(SUITE)}`);
  return <Activation2fa suite={SUITE} />;
}

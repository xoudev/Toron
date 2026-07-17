import { auth } from '@/lib/auth';

// Handlers paresseux : l'instance Better Auth (et la validation d'env)
// n'est construite qu'à la première requête, pas au build.
export async function GET(request: Request): Promise<Response> {
  return auth().handler(request);
}

export async function POST(request: Request): Promise<Response> {
  return auth().handler(request);
}

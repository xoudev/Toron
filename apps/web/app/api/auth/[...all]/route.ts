import { auth } from '@/lib/auth';
import { createAuthRoute } from '@/lib/auth-route';

// Handlers paresseux : l'instance Better Auth (et la validation d'env)
// n'est construite qu'à la première requête, pas au build.
const route = createAuthRoute(() => (request) => auth().handler(request));

export function GET(request: Request): Promise<Response> {
  return route.GET(request);
}

export function POST(request: Request): Promise<Response> {
  return route.POST(request);
}

import { redirect } from 'next/navigation';

/** L'entrée de l'application poursuit le parcours authentifié. */
export default function Home() {
  redirect('/organisations');
}

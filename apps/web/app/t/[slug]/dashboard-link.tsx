'use client';

import { useParams } from 'next/navigation';
import type { ReactNode } from 'react';

/** Lien vers le tableau de bord de l'organisation courante, là où le slug n'est pas transmis (page introuvable). */
export function DashboardLink({ className, children }: { className?: string; children: ReactNode }) {
  const { slug } = useParams<{ slug: string }>();
  return <a className={className} href={`/t/${slug}`}>{children}</a>;
}

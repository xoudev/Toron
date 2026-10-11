import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// Le lien de réinitialisation porte le jeton dans son fragment : ces pages ne
// sont ni indexées ni transmises en référent.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function MotDePasseLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

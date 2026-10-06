import type { FormEvent } from 'react';

/**
 * Soumission sans réinitialisation : avec `<form action>`, React vide les
 * champs à la fin de la transition, même quand l'action renvoie une erreur.
 * Ici, la saisie reste en place pour être corrigée.
 */
export function keepValues(handler: (fd: FormData) => void) {
  return (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    handler(new FormData(e.currentTarget));
  };
}

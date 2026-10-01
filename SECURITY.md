# Politique de sécurité

## Signaler une vulnérabilité

N'ouvrez pas d'issue publique. Utilisez le signalement privé de GitHub :
onglet **Security** du dépôt, puis **Report a vulnerability**.

Merci d'indiquer le composant concerné (application, worker, vitrine,
CI), les étapes de reproduction et l'impact estimé. Aucune donnée réelle
de client ne doit figurer dans le signalement.

## Engagements

- Accusé de réception sous 3 jours ouvrés.
- Évaluation de la gravité et plan de correction sous 7 jours.
- Publication d'un avis de sécurité une fois le correctif déployé, avec
  crédit au découvreur s'il le souhaite.

## Périmètre

Seule la branche `main` est maintenue. Les environnements de démonstration
ne contiennent que des données fictives (tenant « Meridiane Logistics ») :
merci de ne pas les soumettre à des tests de charge ou de déni de service.

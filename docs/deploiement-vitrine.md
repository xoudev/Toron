# Déploiement de la vitrine sur Cloudflare Pages

Vitrine `apps/site` (export statique Next.js) publiée gratuitement sur
Cloudflare Pages (ADR-9), domaine **https://toron.nullsec.fr**.
La vitrine ne traite aucune donnée client : seule l'application (`apps/web`)
est soumise à l'exigence d'hébergement UE sans sous-traitant US.

## Fonctionnement

- `pnpm --filter @toron/site build` produit `apps/site/out/` puis génère
  `out/_headers` (`scripts/security-headers-cli.ts`) : CSP stricte où chaque
  script inline est autorisé par son empreinte SHA-256 (jamais
  `'unsafe-inline'` pour les scripts), HSTS, `X-Frame-Options`,
  `nosniff`, `Permissions-Policy`, cache long sur `/_next/static/*`,
  `noindex` sur les URL `*.pages.dev`.
- `.github/workflows/deploy-vitrine.yml` publie **`main` uniquement** (code
  déjà validé par la CI de la PR), à chaque push qui touche la vitrine, ou
  manuellement. Les tests de la vitrine sont rejoués avant le build, qui
  tourne sans aucun secret ; seul le job de publication voit le jeton, sans
  checkout ni dépendance du projet (wrangler en version épinglée, scripts
  d'installation désactivés).

## Mise en place (une seule fois)

1. **Projet Pages** (compte Cloudflare gratuit) :
   `npx wrangler@4.136.3 login` puis
   `npx wrangler@4.136.3 pages project create toron-vitrine --production-branch=main`.
2. **Jeton d'API** : Cloudflare > *My Profile* > *API Tokens* > *Create
   Token* > *Custom token*, permission **Account / Cloudflare Pages /
   Edit**, ressource limitée à votre compte, date d'expiration définie.
   Aucun autre droit (moindre privilège).
3. **GitHub** (*Settings* du dépôt) :
   - *Environments* > créer `vitrine` > *Deployment branches* : `main`
     uniquement, puis secret d'environnement `CLOUDFLARE_API_TOKEN`.
   - *Secrets and variables* > *Actions* > *Variables* : variable de dépôt
     `CLOUDFLARE_ACCOUNT_ID` (identifiant de compte affiché dans le tableau
     de bord Cloudflare). Tant qu'elle est absente, le workflow est
     « skipped ».
4. **Premier déploiement** : *Actions* > « Déploiement vitrine » > *Run
   workflow* sur `main` (le workflow doit d'abord être fusionné sur `main`).
5. **Domaine `toron.nullsec.fr`** : projet Pages > *Custom domains* > *Set
   up a custom domain* > `toron.nullsec.fr`, **avant** toute modification
   DNS (sinon erreur 522). Puis :
   - zone `nullsec.fr` gérée par Cloudflare : l'enregistrement est créé
     automatiquement ;
   - zone gérée ailleurs (OVH, Gandi, etc.) : ajouter
     `toron  CNAME  toron-vitrine.pages.dev.`
   - si `nullsec.fr` porte des enregistrements CAA, autoriser les
     autorités de certification utilisées par Cloudflare (voir la doc
     Cloudflare « CAA records »), sinon le certificat TLS ne sera pas émis.

## Vérification

```sh
curl -sI https://toron.nullsec.fr | grep -iE 'content-security-policy|strict-transport-security|x-frame-options'
```

Puis contrôle externe (Mozilla Observatory / securityheaders.com).

## Limites connues

- La CSP regroupe les empreintes de toutes les pages sur une ligne
  (~1 400 caractères aujourd'hui, limite Cloudflare 2 000). Au-delà, le
  build échoue explicitement : il faudra alors une CSP par chemin.
- Les liens « Se connecter » et « Demander une démo » pointent vers
  `app.toron.fr` et `bonjour@toron.fr`, à aligner sur les domaines réels.
- Rotation : renouveler le jeton avant expiration ; en cas de fuite, le
  révoquer dans Cloudflare puis mettre à jour le secret d'environnement.

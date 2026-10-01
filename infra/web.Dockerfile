# Toron — image de l'application web (Next.js standalone), ADR-9.
# Multi-stage, versions épinglées, utilisateur non-root.
# Contexte de build : la racine du monorepo (docker build -f infra/web.Dockerfile .)

FROM node:26.10.0-alpine3.23@sha256:c3c6e314fd42e41962360b2482fc18d150beb47976c3aa7b8b9689d7ef42a5c2 AS base

# ── Dépendances + build ──────────────────────────────────────────────
FROM base AS build
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/site/package.json apps/site/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/ui/package.json packages/ui/
COPY packages/frameworks/package.json packages/frameworks/
COPY packages/typst/package.json packages/typst/
COPY workers/package.json workers/
# Corepack n'est plus livré avec Node 26 : pnpm est installé par npm, à la
# version exacte du champ packageManager de package.json (source unique, la
# même qu'en CI), sans exécution de scripts d'installation.
RUN npm install --global --ignore-scripts --no-audit --no-fund \
      "pnpm@$(node -p "require('./package.json').packageManager.split('@')[1]")"
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY apps/web apps/web
COPY packages packages
COPY workers workers
RUN pnpm --filter @toron/web build

# ── Image d'exécution minimale ───────────────────────────────────────
FROM node:26.10.0-alpine3.23@sha256:c3c6e314fd42e41962360b2482fc18d150beb47976c3aa7b8b9689d7ef42a5c2 AS run
ENV NODE_ENV=production
WORKDIR /app
# Gestionnaires de paquets inutiles à l'exécution (CMD lance node seul) : npm
# embarque ses propres dépendances, souvent en retard sur les correctifs, et
# chaque outil retiré réduit la surface d'attaque de l'image livrée.
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx \
      /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-v* \
 && addgroup -S toron && adduser -S toron -G toron
COPY --from=build --chown=toron:toron /repo/apps/web/.next/standalone ./
COPY --from=build --chown=toron:toron /repo/apps/web/.next/static ./apps/web/.next/static
USER toron
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "apps/web/server.js"]

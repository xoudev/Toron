# Toron — image de l'application web (Next.js standalone), ADR-9.
# Multi-stage, versions épinglées, utilisateur non-root.
# Contexte de build : la racine du monorepo (docker build -f infra/web.Dockerfile .)

FROM node:22.21.0-alpine3.22 AS base
RUN corepack enable pnpm

# ── Dépendances + build ──────────────────────────────────────────────
FROM base AS build
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY apps/web/package.json apps/web/
COPY apps/site/package.json apps/site/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/ui/package.json packages/ui/
COPY packages/frameworks/package.json packages/frameworks/
COPY packages/typst/package.json packages/typst/
COPY workers/package.json workers/
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY apps/web apps/web
COPY packages packages
COPY workers workers
RUN pnpm --filter @toron/web build

# ── Image d'exécution minimale ───────────────────────────────────────
FROM node:22.21.0-alpine3.22 AS run
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S toron && adduser -S toron -G toron
COPY --from=build --chown=toron:toron /repo/apps/web/.next/standalone ./
COPY --from=build --chown=toron:toron /repo/apps/web/.next/static ./apps/web/.next/static
USER toron
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "apps/web/server.js"]

# Toron — image du worker de livrables scellés (ADR-5/7).
# Node + binaire Typst (musl). Le worker exécute le TypeScript directement
# (type stripping natif de Node 24) ; pas d'étape de build.
# Contexte de build : la racine du monorepo.

FROM node:24.18.0-alpine3.23
RUN corepack enable pnpm

# ── Binaire Typst (build statique musl, épinglé) ─────────────────────────
ARG TYPST_VERSION=0.12.0
RUN apk add --no-cache xz \
 && wget -qO /tmp/typst.tar.xz "https://github.com/typst/typst/releases/download/v${TYPST_VERSION}/typst-x86_64-unknown-linux-musl.tar.xz" \
 && tar -xJf /tmp/typst.tar.xz -C /tmp \
 && mv /tmp/typst-x86_64-unknown-linux-musl/typst /usr/local/bin/typst \
 && rm -rf /tmp/typst* \
 && typst --version

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
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages packages
COPY workers workers

RUN addgroup -S toron && adduser -S toron -G toron && chown -R toron:toron /repo
USER toron
CMD ["node", "workers/src/index.ts"]

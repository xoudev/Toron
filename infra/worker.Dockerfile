# Toron — image du worker de livrables scellés (ADR-5/7).
# Node + binaire Typst (musl). Le worker exécute le TypeScript directement
# (type stripping natif de Node 24) ; pas d'étape de build.
# Contexte de build : la racine du monorepo.
#
# Multi-stage : pnpm et son cache restent dans l'étage « deps » ; l'image
# livrée ne contient ni pnpm, ni npm, ni corepack.

FROM node:24.21.0-alpine3.23@sha256:9ec4a2e289874ed0d722e1772ec2de45d2801541db8612f3638b26f128c69ac2 AS base

# ── Dépendances et sources ───────────────────────────────────────────────
FROM base AS deps
RUN corepack enable pnpm
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

# ── Image d'exécution ────────────────────────────────────────────────────
FROM base AS run

# Gestionnaires de paquets inutiles à l'exécution (CMD lance node seul) : npm
# embarque ses propres dépendances, souvent en retard sur les correctifs.
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx \
      /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-v*

# ── Binaire Typst (build statique musl, épinglé) ─────────────────────────
# Version ET empreinte figées : une archive republiée ou altérée fait échouer
# le build. Empreinte relevée sur l'archive officielle de la release, dont le
# binaire déclare le commit 737895d7 du tag v0.12.0. Changer les deux ensemble.
ARG TYPST_VERSION=0.12.0
ARG TYPST_SHA256=605130a770ebd59a4a579673079cb913a13e75985231657a71d6239a57539ec3
SHELL ["/bin/ash", "-eo", "pipefail", "-c"]
RUN apk add --no-cache xz \
 && wget -qO /tmp/typst.tar.xz "https://github.com/typst/typst/releases/download/v${TYPST_VERSION}/typst-x86_64-unknown-linux-musl.tar.xz" \
 && echo "${TYPST_SHA256}  /tmp/typst.tar.xz" | sha256sum -c - \
 && tar -xJf /tmp/typst.tar.xz -C /tmp \
 && mv /tmp/typst-x86_64-unknown-linux-musl/typst /usr/local/bin/typst \
 && rm -rf /tmp/typst* \
 && typst --version

# Code et dépendances appartenant à root : le processus du worker (toron)
# les lit sans pouvoir les modifier.
COPY --from=deps /repo /repo
WORKDIR /repo
RUN addgroup -S toron && adduser -S toron -G toron
USER toron
CMD ["node", "workers/src/index.ts"]

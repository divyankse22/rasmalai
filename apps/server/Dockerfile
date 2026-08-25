# Build from the repository root:  docker build -f apps/server/Dockerfile -t rasmalai-server .
# The build context is the monorepo root because the server bundles both workspace packages.
#
# `packages/games` has to be copied as well as `packages/shared`: tsup lists both in `noExternal`,
# so the rulebooks are compiled into `dist` rather than resolved at runtime. This file was written
# in slice 1 and the games package arrived in slice 7, which left the image unbuildable in between.
# Its browser-only peers (react, phaser) are deliberately *not* installed here — the server imports
# `@rasmalai/games/server`, which reaches no renderer, and an optional peer nobody imports is an
# optional peer npm is happy to leave out.

FROM node:24-alpine AS builder
WORKDIR /app

# Manifests first, so dependency installation caches independently of source changes.
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
COPY packages/games/package.json packages/games/
RUN npm ci

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/games packages/games
COPY apps/server apps/server
COPY supabase/migrations supabase/migrations
RUN npm run build -w @rasmalai/server && npm prune --omit=dev

FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000

# Migrations run at boot (index.ts), reading supabase/migrations/*.sql off disk via a path resolved
# from `process.cwd()` relative to the server workspace (`../../supabase/migrations` — the same
# convention certificateAuthority.ts's DEFAULT_CA_PATH uses). That resolution is bundler-agnostic by
# design: `process.cwd()` only depends on where the process was launched, unlike `import.meta.url`,
# which would report the bundled dist/index.js's own location and break this arithmetic differently
# in dev (unbundled, run from src/db/) versus here (bundled to one file). So rather than teach that
# code two different path strategies, the image mirrors the repo's actual nesting instead: dist
# lives at apps/server/dist, not flattened to the image root, and the process is launched from
# apps/server — exactly where it runs from locally.
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/apps/server/dist ./apps/server/dist
COPY --from=builder --chown=node:node /app/supabase/migrations ./supabase/migrations

USER node
WORKDIR /app/apps/server
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:${PORT}/healthz || exit 1

CMD ["node", "dist/index.js"]

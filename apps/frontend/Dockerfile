# Next.js frontend (board C-5, ALPHA_PLAN 7.3). Build context is the repo
# root (npm workspaces, one root lockfile) -- see apps/backend/Dockerfile's
# same note.
#
#   docker build -f apps/frontend/Dockerfile -t movie-frontend .
#
# `next.config.ts` does not set `output: 'standalone'` (apps/frontend/**,
# session B's file), so this ships `next start` with a full production
# node_modules rather than Next's minimal standalone server -- a larger
# image, correct either way. Switching that one line would let this
# Dockerfile's runtime stage drop to `.next/standalone` + `.next/static`
# only; flagged on the board rather than edited here.

FROM node:22-alpine AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/frontend/package.json apps/frontend/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY tsconfig.json ./
RUN npm ci

FROM deps AS build
COPY packages/shared packages/shared
COPY apps/frontend apps/frontend
RUN npm run build -w @movie/shared && npm run build -w frontend

FROM node:22-alpine AS prod-deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/frontend/package.json apps/frontend/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci --omit=dev

FROM node:22-alpine AS runtime
RUN apk add --no-cache dumb-init && addgroup -S app && adduser -S app -G app
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=prod-deps /repo/node_modules node_modules
COPY --from=prod-deps /repo/apps/frontend/package.json apps/frontend/package.json
COPY --from=build /repo/packages/shared/dist packages/shared/dist
COPY --from=build /repo/packages/shared/package.json packages/shared/package.json
COPY --from=build /repo/apps/frontend/.next apps/frontend/.next
COPY --from=build /repo/apps/frontend/public apps/frontend/public
COPY --from=build /repo/apps/frontend/next.config.ts apps/frontend/next.config.ts
USER app
WORKDIR /repo/apps/frontend
EXPOSE 3110
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT:-3110}/ || exit 1
ENTRYPOINT ["dumb-init", "--"]
CMD ["npx", "next", "start", "-p", "3110"]

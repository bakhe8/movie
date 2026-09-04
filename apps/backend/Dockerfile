# NestJS backend (board C-5, ALPHA_PLAN 7.3). npm workspaces monorepo, so the
# build context is the repo root (`docker compose -f docker/docker-compose.prod.yml`
# sets `context: ..`), not this directory -- `npm ci` needs every workspace's
# package.json to resolve the one root lockfile.
#
#   docker build -f apps/backend/Dockerfile -t movie-backend .

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
COPY apps/backend apps/backend
RUN npm run build -w @movie/shared && npm run build -w @movie/backend

# Production-only node_modules, the same lockfile, kept in its own stage so
# the final image never carries dev dependencies or TypeScript source.
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
COPY --from=prod-deps /repo/apps/backend/package.json apps/backend/package.json
COPY --from=build /repo/packages/shared/dist packages/shared/dist
COPY --from=build /repo/packages/shared/package.json packages/shared/package.json
COPY --from=build /repo/apps/backend/dist apps/backend/dist
COPY docker/read-secrets.sh /usr/local/bin/read-secrets.sh
RUN chmod +x /usr/local/bin/read-secrets.sh
USER app
WORKDIR /repo/apps/backend
EXPOSE 3101
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${API_PORT:-3101}/api/health || exit 1
ENTRYPOINT ["/usr/local/bin/read-secrets.sh"]
CMD ["node", "dist/main.js"]

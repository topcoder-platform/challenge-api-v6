ARG NODE_VERSION=26.5.1
ARG ALPINE_VERSION=3.24
ARG PNPM_VERSION=11.15.1

FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS node-base

FROM node-base AS build

ARG PNPM_VERSION

RUN apk upgrade --no-cache \
    && apk add --no-cache openssl \
    && npm install --global pnpm@${PNPM_VERSION}

WORKDIR /challenge-api
COPY . .
RUN pnpm install --frozen-lockfile \
    && pnpm lint \
    && pnpm build \
    && rm -rf dist/src/scripts dist/src/phase-management/mocks \
    && rm -f dist/tsconfig.build.tsbuildinfo \
    && node --check mock-api/app.js \
    && node --check mock-api/config/default.js \
    && CI=true pnpm prune --prod \
    && find node_modules -type f \
        \( -name yarn.lock -o -name package-lock.json -o -name pnpm-lock.yaml \
        -o -name npm-shrinkwrap.json \) -delete \
    && rm -f pnpm-lock.yaml \
        node_modules/.modules.yaml \
        node_modules/.package-map.json \
        node_modules/.pnpm-workspace-state-v1.json \
        node_modules/.pnpm/lock.yaml

FROM alpine:${ALPINE_VERSION} AS runtime

# Match the production image: use the build's Node binary instead of an APK
# revision that Alpine may remove when it publishes a newer Node patch.
COPY --from=node-base /usr/local/bin/node /usr/local/bin/node
ARG NODE_VERSION
RUN apk upgrade --no-cache \
    && apk add --no-cache ca-certificates libatomic libstdc++ openssl \
    && test "$(node --version)" = "v${NODE_VERSION}" \
    && addgroup -S app \
    && adduser -S -D -u 10001 -G app app

WORKDIR /challenge-api

# The mock uses the compiled Challenge Prisma adapter for its one DB-backed
# endpoint; all other endpoints are static. Copy only production dependencies,
# compiled runtime code, and the mock's JavaScript/configuration.
COPY --from=build --chown=app:app /challenge-api/node_modules ./node_modules
COPY --from=build --chown=app:app /challenge-api/dist ./dist
COPY --from=build --chown=app:app /challenge-api/mock-api/app.js ./mock-api/app.js
COPY --from=build --chown=app:app /challenge-api/mock-api/config ./mock-api/config

USER app
WORKDIR /challenge-api/mock-api
CMD ["node", "app.js"]

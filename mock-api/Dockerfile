ARG NODE_VERSION=26.5.1
ARG PNPM_VERSION=11.15.1

FROM node:${NODE_VERSION}-alpine AS build

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

FROM alpine:3.24 AS runtime

ARG NODE_VERSION
RUN apk upgrade --no-cache \
    && apk add --no-cache ca-certificates nodejs-current=${NODE_VERSION}-r0 openssl \
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

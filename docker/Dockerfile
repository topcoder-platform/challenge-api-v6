# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=26.5.1
ARG PNPM_VERSION=11.15.1

FROM node:${NODE_VERSION}-alpine AS build-base

RUN apk upgrade --no-cache \
    && apk add --no-cache openssl
WORKDIR /challenge-api
RUN npm install --global pnpm@${PNPM_VERSION}

FROM build-base AS build

COPY . .
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc,required=false \
    pnpm install --frozen-lockfile
RUN pnpm lint && pnpm build \
    && rm -rf dist/src/scripts dist/src/phase-management/mocks \
    && rm -f dist/tsconfig.build.tsbuildinfo
RUN CI=true pnpm prune --prod \
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

ENV NODE_OPTIONS="--report-on-fatalerror --report-uncaught-exception --report-signal=SIGUSR2 --report-directory=/challenge-api/reports --report-filename=report.%p.%t.json --enable-source-maps" \
    PRISMA_LOG_LEVEL=info \
    RUST_BACKTRACE=1

# Copy only the compiled application, production dependencies, runtime
# configuration, and Prisma migration assets. Development dependencies, source,
# repository metadata, and lockfiles never enter the production image.
COPY --from=build --chown=app:app /challenge-api/node_modules ./node_modules
COPY --from=build --chown=app:app /challenge-api/dist ./dist
COPY --from=build --chown=app:app /challenge-api/config ./config
COPY --from=build --chown=app:app /challenge-api/docs/swagger.yaml ./docs/swagger.yaml
COPY --from=build --chown=app:app /challenge-api/prisma ./prisma
COPY --from=build --chown=app:app /challenge-api/prisma.config.ts ./prisma.config.ts
COPY --from=build --chown=app:app --chmod=0555 /challenge-api/docker/entrypoint.sh /entrypoint.sh
RUN mkdir -p /challenge-api/reports \
    && chown app:app /challenge-api/reports

USER app
ENTRYPOINT ["/entrypoint.sh"]

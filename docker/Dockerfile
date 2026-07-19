# syntax=docker/dockerfile:1.7

FROM node:22.19.0-alpine AS base

RUN apk add --no-cache openssl
WORKDIR /challenge-api
RUN npm install --global pnpm@9.15.9

FROM base AS build

COPY . .
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc,required=false \
    pnpm install --frozen-lockfile
RUN pnpm lint && pnpm build

FROM base AS runtime

ENV NODE_OPTIONS="--report-on-fatalerror --report-uncaught-exception --report-signal=SIGUSR2 --report-directory=/challenge-api/reports --report-filename=report.%p.%t.json --enable-source-maps" \
    PRISMA_LOG_LEVEL=info \
    RUST_BACKTRACE=1

# Prisma migrations need the CLI, schema and generated runtime assets at startup,
# so retain the validated install from the build stage rather than pruning it.
COPY --from=build --chown=node:node /challenge-api /challenge-api
COPY --from=build /challenge-api/docker/entrypoint.sh /entrypoint.sh
RUN chmod 0555 /entrypoint.sh \
    && mkdir -p /challenge-api/reports \
    && chown node:node /challenge-api/reports

USER node
ENTRYPOINT ["/entrypoint.sh"]

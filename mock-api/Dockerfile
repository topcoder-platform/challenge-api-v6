FROM node:26.4.0-alpine3.23

RUN apk upgrade --no-cache \
    && apk add --no-cache openssl \
    && npm install --global pnpm@11.15.1

WORKDIR /challenge-api
COPY . .
RUN pnpm install --frozen-lockfile \
    && pnpm build

WORKDIR /challenge-api/mock-api
RUN npm ci

RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/pnpm \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/pnpm \
        /usr/local/bin/pnpx /usr/local/bin/corepack

CMD ["node", "--require", "../node_modules/ts-node/register/transpile-only", "app"]

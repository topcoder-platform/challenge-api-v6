FROM node:22.19.0-alpine

RUN apk add --no-cache openssl \
    && npm install --global pnpm@9.15.9

WORKDIR /challenge-api
COPY . .
RUN pnpm install --frozen-lockfile \
    && pnpm build

WORKDIR /challenge-api/mock-api
RUN npm ci

CMD ["npm", "start"]

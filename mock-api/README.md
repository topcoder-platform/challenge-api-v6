# Mock TC API


## Dependencies
- Node.js 26.4.0 (use the version in the repository's `.nvmrc`)
- Root Challenge API dependencies installed with pnpm 11.15.1


## Configuration
Configuration is at `config/default.js`, you may also set env variables.
There are following config params:
- `PORT`: REST app port, default value is 4000


## Local deployment
- From the repository root, run `nvm use && pnpm install`
- In this directory, run `nvm use && npm ci` for direct local mock development
- Start app with `npm start`; the production mock image uses the root pnpm
  production dependency set and compiled Challenge Prisma client
- App is running at `http://localhost:4000`

The local start command registers the root TypeScript runtime. The production
image instead uses the compiled Challenge API Prisma client and contains no
TypeScript source or development dependencies. Set the existing `DATABASE_URL`
when exercising mock endpoints that read challenge data.

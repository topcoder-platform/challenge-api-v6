# Mock TC API


## Dependencies
- Node.js 22 (use the version in the repository's `.nvmrc`)
- Root Challenge API dependencies installed with pnpm


## Configuration
Configuration is at `config/default.js`, you may also set env variables.
There are following config params:
- `PORT`: REST app port, default value is 4000


## Local deployment
- From the repository root, run `nvm use && pnpm install`
- In this directory, run `nvm use && npm ci`
- Start app `npm start`
- App is running at `http://localhost:4000`

The start command registers the root TypeScript runtime because this support
service reuses the Challenge API Prisma client. Set the existing `DATABASE_URL`
when exercising mock endpoints that read challenge data.

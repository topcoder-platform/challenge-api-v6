# Topcoder Challenge API

This microservice provides access and interaction with all sorts of Challenge data.

## Development status

### Deployment status

Dev: [![CircleCI](https://circleci.com/gh/topcoder-platform/challenge-api/tree/develop.svg?style=svg)](https://circleci.com/gh/topcoder-platform/challenge-api/tree/develop) Prod: [![CircleCI](https://circleci.com/gh/topcoder-platform/challenge-api/tree/master.svg?style=svg)](https://circleci.com/gh/topcoder-platform/challenge-api/tree/master)

## Swagger definition

- [Swagger](https://api.topcoder.com/v6/challenges/api-docs/)

## Intended use

- Production API

## Related repos

- [Resources API](https://github.com/topcoder-platform/resources-api)

## Prerequisites

- [Node.js](https://nodejs.org/en/) 26.4.0 (use the version in `.nvmrc`)
- [pnpm](https://pnpm.io/) 11.15.1
- [AWS S3](https://aws.amazon.com/s3/)
- [Docker](https://www.docker.com/)
- [Docker Compose](https://docs.docker.com/compose/)

## Technology

The API is written in TypeScript and runs on NestJS 11 with the Express adapter.
The adapter mounts the established Express middleware and route graph so existing
HTTP routes, validation, authentication, response bodies, and middleware ordering
remain compatible. Database access uses Prisma 7 with the PostgreSQL driver
adapter. Domain events continue to be sent through the existing Bus API wrapper;
this service does not connect to Kafka directly.

The API runtime client is Prisma 7. The checked-in
`packages/challenge-prisma-client` artifact remains on Prisma 6 for its existing
downstream consumers, so the root generation command intentionally targets only
the API client. Upgrading that shared artifact requires a coordinated downstream
release.

## Configuration

Configuration for the application is at `config/default.js`.
The following parameters can be set in config files or in env variables:

- READONLY: sets the API in read-only mode. POST/PUT/PATCH/DELETE operations will return 403 Forbidden
- LOG_LEVEL: the log level, default is 'debug'
- PORT: the server port, default is 3000
- AUTH_SECRET: The authorization secret used during token verification.
- VALID_ISSUERS: The valid issuer of tokens.
- AUTH0_URL: AUTH0 URL, used to get M2M token
- AUTH0_PROXY_SERVER_URL: AUTH0 proxy server URL, used to get M2M token
- AUTH0_AUDIENCE: AUTH0 audience, used to get M2M token
- TOKEN_CACHE_TIME: AUTH0 token cache time, used to get M2M token
- AUTH0_CLIENT_ID: AUTH0 client id, used to get M2M token
- AUTH0_CLIENT_SECRET: AUTH0 client secret, used to get M2M token
- BUSAPI_URL: Bus API URL
- KAFKA_ERROR_TOPIC: Kafka error topic used by bus API wrapper
- AMAZON.AWS_ACCESS_KEY_ID: The Amazon certificate key to use when connecting.
- AMAZON.AWS_SECRET_ACCESS_KEY: The Amazon certificate access key to use when connecting.
- AMAZON.AWS_REGION: The Amazon certificate region to use when connecting.
- AMAZON.ATTACHMENT_S3_BUCKET: the AWS S3 bucket to store attachments
- FILE_UPLOAD_SIZE_LIMIT: the file upload size limit in bytes
- MEMBERS_API_URL: member-api members base URL; used to trigger challenge submitter rating updates after a challenge is completed
- RESOURCES_API_URL: TC resources API base URL
- GROUPS_API_URL: TC groups API base URL
- PROJECTS_API_URL: TC projects API base URL
- CHALLENGE_MIGRATION_APP_URL: migration app URL
- TERMS_API_URL: TC Terms API Base URL
- COPILOT_RESOURCE_ROLE_IDS: copilot resource role ids allowed to upload attachment
- HEALTH_CHECK_TIMEOUT: health check timeout in milliseconds
- SCOPES: the configurable M2M token scopes, refer `config/default.js` for more details
- M2M_AUDIT_HANDLE: the audit name used when perform create/update operation using M2M token
- FORUM_TITLE_LENGTH_LIMIT: the forum title length limit
- DATABASE_URL: PostgreSQL connection URL for the challenge database
- REVIEW_DB_URL: optional PostgreSQL connection URL for review data; existing
  deployments may continue to omit it when review-database access is not used

You can find sample `.env` files inside the `/docs` directory.
The TypeScript, NestJS, and Prisma 7 migration does not introduce or rename any
configuration parameters.

## Available commands

Run `nvm use` before pnpm commands. Make sure `DATABASE_URL` is set before any
database operation or application startup.

1. Install dependencies and generate the Prisma client: `pnpm install`
2. Build the API: `pnpm build`
3. Create or update local database tables: `pnpm create-tables`
4. Seed tables: `pnpm seed-tables`
5. Start local supporting services: `pnpm services:up`
6. Stop local supporting services: `pnpm services:down`
7. Check supporting-service logs: `pnpm services:logs`

### Notes

- The seed data are located in `src/scripts/seed`

## Local Deployment

0. Select the repository's Node 26.4.0 version with

   ```bash
   nvm use
   ```

1. ⚙ Local config
   In the `challenge-api` root directory create `.env` file with the next environment variables. Values for **Auth0 config** should be shared with you on the forum.<br>

   ```bash
   # Auth0 config
   AUTH0_URL=
   AUTH0_PROXY_SERVER_URL=
   AUTH0_AUDIENCE=
   AUTH0_CLIENT_ID=
   AUTH0_CLIENT_SECRET=
   ```

   - Values from this file are automatically used by the application and Prisma commands.
   - ⚠️ Never commit this file or its copy to the repository!

   Please make sure database url is configured before everything.
   ```bash
   DATABASE_URL=
   ```

   Then run `pnpm install`. The postinstall hook generates the Prisma 7 client.

2. 🚢 Start docker-compose with services which are required to start Topcoder Challenges API locally

   ```bash
   pnpm services:up
   ```
   This command will start postgres with docker-compose.

   If you are running services with docker, you can run:
   ```bash
   docker run -d --name challengedb -p 5432:5432 \
      -e POSTGRES_USER=johndoe -e POSTGRES_DB=challengedb \
      -e POSTGRES_PASSWORD=mypassword \
      postgres:16.8
   ```

   The command to set `DATABASE_URL` environment variable will be like
   ```bash
   export DATABASE_URL="postgresql://johndoe:mypassword@localhost:5432/challengedb?schema=public"
   ```
   Set it before running database commands or starting the API.


3. ♻ Running mock-api:

   TopCoder Challenge API calls many other APIs like Terms API, Groups API, Projects API, Resources API.

   Starting them all is a little complicated. Mock APIs are created in `mock-api`.

   You can run it with
   ```bash
   cd mock-api
   npm start
   ```
   It will start a mock service at port `4000` at default, and it works well with Challenge API.

   You might also need to update the API URLs in `config/default.js` Line 44~57 with environment variables. The commands are like:
   ```bash
   export RESOURCES_API_URL="http://localhost:4000/v5/resources"
   export PROJECTS_API_URL="http://localhost:4000/v5/projects"
   export TERMS_API_URL="http://localhost:4000/v5/terms"
   export RESOURCE_ROLES_API_URL="http://localhost:4000/v5/resource-roles"
   ```

4. ♻ Create tables and setup testdata

   To create database tables, you can run:
   ```bash
   pnpm create-tables
   ```

   To create test data, you can run:
   ```bash
   pnpm seed-tables
   ```

5. Configure external integrations

   Authenticated operations and event publication use the existing Auth0 and
   Bus API settings. Configure `AUTH0_*` and `BUSAPI_URL` for environments that
   exercise those paths. Topics disabled by the existing topic configuration are
   skipped exactly as before; no local Kafka connection is required.

6. 🚀 Start Topcoder Challenge API

   ```bash
   pnpm start
   ```

   The Topcoder Challenge API will be served on `http://localhost:3000`

## Production deployment

- TBD

## Running tests

### Configuration

Tests use `config/default.js` plus environment-variable overrides. The following
test parameters can be set with environment variables:

- ADMIN_TOKEN: admin token
- COPILOT_TOKEN: copilot token
- USER_TOKEN: user token
- EXPIRED_TOKEN: expired token
- INVALID_TOKEN: invalid token
- M2M_FULL_ACCESS_TOKEN: M2M full access token
- M2M_READ_ACCESS_TOKEN: M2M read access token
- M2M_UPDATE_ACCESS_TOKEN: M2M update (including 'delete') access token
- S3_ENDPOINT: endpoint of AWS S3 API, for unit and e2e test only; default to `localhost:9000`

### Prepare

- Start Local services in docker.
- Create tables.
- Various config parameters should be properly set.

Seeding db data is not needed.

### Running unit tests

To run unit tests alone

```bash
pnpm test
```

To run unit tests with coverage report

```bash
pnpm test:cov
```

### Running integration tests

To run integration tests alone

```bash
pnpm e2e
```

To run integration tests with coverage report

```bash
pnpm e2e:cov
```

## Verification

Refer to the verification document `Verification.md`

## Notes

- after uploading attachments, the returned attachment ids should be used to update challenge;
  finally, attachments have challengeId field linking to their challenge,
  challenge also have attachments field linking to its attachments,
  this will speed up challenge CRUDS operations.

- Topic names are defined in `app-constants.ts`. Event envelopes are posted to
  the Bus API, which owns Kafka integration for this service.

**Downstream Usage**

- This service is consumed by multiple Topcoder apps. Below is a quick map of where and how it’s called to help with debugging.

**platform-ui**

- Admin and Review apps read challenge data and metadata via v6 endpoints:
  - Search challenges: `GET /v6/challenges?{filters}`. See `platform-ui/src/apps/admin/src/lib/services/challenge-management.service.ts`.
  - Fetch challenge by id: `GET /v6/challenges/{id}`. See `platform-ui/src/apps/admin/src/lib/services/challenge-management.service.ts` and `platform-ui/src/apps/review/src/lib/services/challenges.service.ts`.
  - Challenge types and tracks: `GET /v6/challenge-types`, `GET /v6/challenge-tracks`. See `platform-ui/src/apps/admin/src/lib/services/challenge-management.service.ts` and `platform-ui/src/apps/review/src/lib/services/challenges.service.ts`.
  - Support requests: `POST /v6/challenges/support-requests`. See `platform-ui/src/libs/shared/lib/components/contact-support-form/contact-support-functions/contact-support-store/contact-support.store.ts`.
- Local dev proxy maps `/v6/challenges`, `/v6/challenge-types`, `/v6/challenge-tracks`, `/v6/challenge-phases`, and `/v6/timeline-templates` to this service on port 3000. See `platform-ui/src/config/environments/local.env.ts`.

**community-app**

- Uses v6 endpoints for public challenge listing and details:
  - List/search challenges for dashboards and content blocks: `GET /v6/challenges?{filters}`. See `community-app/src/shared/services/dashboard.js` and `community-app/src/shared/actions/contentful.js`.
  - Fetch challenge details (e.g., for review opportunity details pages): `GET /v6/challenges/{id}`. See `community-app/src/shared/services/reviewOpportunities.js`.

**work-manager**

- Work Manager CRUD and metadata flows rely on v6 Challenge API:
  - Get challenge details: `GET /v6/challenges/{id}`. See `work-manager/src/services/challenges.js`.
  - Create/update/delete challenges: `POST /v6/challenges`, `PUT /v6/challenges/{id}`, `PATCH /v6/challenges/{id}`, `DELETE /v6/challenges/{id}`. See `work-manager/src/services/challenges.js`.
  - Manage attachments: `POST /v6/challenges/{id}/attachments`, `DELETE /v6/challenges/{id}/attachments/{attachmentId}`. See `work-manager/src/services/challenges.js`.
  - Default reviewers: `GET /v6/challenge/default-reviewers?typeId&trackId`. See `work-manager/src/services/challenges.js`.
  - Challenge metadata: `GET /v6/challenge-types`, `GET /v6/challenge-tracks`, `GET /v6/challenge-phases`, `GET /v6/challenge-timelines`. See `work-manager/src/services/challenges.js` and config under `work-manager/config/constants/*`.
- Challenge `metadata` may include `submission_type` to override the community-app submission flow:
  `zip` shows the standard Topcoder zip upload page, and `url` shows the Topgear URL upload page.
  When omitted, consumers should keep their existing default behavior.
- Challenge `metadata` uses the exact string values `true` and `false` for `is_test_challenge`.
  Challenge creation adds `is_test_challenge: false` when it is omitted. `NEW` challenges retain
  their existing deletion behavior. A `COMPLETED` or `CANCELLED*` challenge can be deleted when this
  metadata value is exactly `true`; `DRAFT`, `APPROVED`, and `ACTIVE` challenges cannot use this
  bypass. Any update that starts in or transitions to a completed or cancelled status cannot change
  the effective `is_test_challenge` value; omitting metadata preserves it. Normal authorization
  checks still apply.
- API base configuration points to v6 in dev/local and v5 in prod (for compatibility):
  - Dev: `work-manager/config/constants/development.js`.
  - Local: `work-manager/config/constants/local.js`.
  - Prod: `work-manager/config/constants/production.js`.

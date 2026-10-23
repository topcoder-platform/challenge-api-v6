# Keycloak M2M migration branch

This code is isolated on `keycloak_m2M`. Do not deploy this branch until the
workload and its callers are ready. Existing DEV services continue using Auth0.
The core dependency is pinned to a reviewed Keycloak prerelease commit, including
transitive wrapper uses through the pnpm override. No npm latest dependency is used.

The core is pinned to `tc-core-library-js` commit `112d54a` (4.0.0-keycloak.2) in
`package.json` and the `pnpm-workspace.yaml` override, and `pnpm-lock.yaml` resolves
that single version, including the copy `topcoder-bus-api-wrapper` uses.

## Provider switch: `USE_KEYCLOAK`

`USE_KEYCLOAK=true` makes this service get its M2M tokens from Keycloak, using
`KEYCLOAK_TOKEN_URL`, `KEYCLOAK_AUDIENCE`, `KEYCLOAK_CLIENT_ID` and
`KEYCLOAK_CLIENT_SECRET` (optional `KEYCLOAK_SCOPE` narrows the client's defaults).
`KEYCLOAK_ISSUER` is also required. Unset or `false` restores the Auth0 behaviour from
before the migration: `src/common/m2m-helper.ts` (projects, resources, submissions and
other downstream calls) and the Bus client in `src/common/helper.ts` use `AUTH0_URL`,
`AUTH0_AUDIENCE` (default `https://www.topcoder-dev.com`), `AUTH0_PROXY_SERVER_URL`
(default `AUTH0_URL`), `AUTH0_CLIENT_ID` and `AUTH0_CLIENT_SECRET`; `TOKEN_CACHE_TIME`
is passed to the Bus wrapper as before.

`tc-core-library-js` reads the flag (`auth.useKeycloak`), `M2MHelper` passes the Auth0
settings to `auth.m2m`, and the Bus client gets its settings from `auth.wrapperSettings`,
so the service and the core always agree. Any value other than `true`/`false` fails at
startup. In DEV the flag is `/config/common/global-appvar/USE_KEYCLOAK`.

Incoming machine tokens: with `true`, Keycloak tokens are accepted, plus Auth0 tokens
while `LEGACY_M2M_ISSUERS`/`LEGACY_M2M_AUDIENCE` are set. With `false`, Auth0 tokens
are accepted through `LEGACY_M2M_*`, plus Keycloak tokens while `KEYCLOAK_ISSUER` and
`KEYCLOAK_AUDIENCE` are set, so callers that have not switched yet keep working.

**Rollback:** set `USE_KEYCLOAK=false` and force a new deployment so tasks re-read SSM.
No code or dependency change is needed. Keep the Auth0 settings above in SSM until
Keycloak has been accepted.

The DEV issuer is `https://keycloak.topcoder-dev.com/realms/topcoder-m2m-dev`,
audience `https://api.topcoder-dev.com`, and managed endpoint
`https://keycloak.topcoder-dev.com/m2m/token`. The managed endpoint passed DEV deployment acceptance; enable this configuration
only with workload-specific grants and rollout approval.

Member sessions remain Auth0. Keep `VALID_ISSUERS` and `AUTH_SECRET` where legacy
member HMAC tokens are supported. Set `AUTH_USER_AUDIENCES` to a JSON array, or
explicitly retain existing user-token audience behavior with
`ALLOW_LEGACY_USER_AUDIENCE=true`. Never apply that exception to M2M tokens.
`LEGACY_M2M_ISSUERS` and `LEGACY_M2M_AUDIENCE` let Auth0 machine tokens pass the same
normalizer (see the provider switch above).

`tc-core-library-js` owns signature, issuer, audience, lifetime, and machine/user
classification. Service adapters must use its verified `kind`, `isMachine`, and
`scopes` rather than decode/reclassify claims. Scope guards delegate exact matching
to the library with explicit all/any policy. Existing business roles and documented
scope aliases remain endpoint policy; adding OAuth scopes to a user token never
grants machine access. No permissive fallback or synthetic token path is available.

Before rollout run this project's `nvm use`, `pnpm lint`, `pnpm build`, and targeted
authentication tests. Validate real authorized/unauthorized routes with both a
Keycloak service token and a member token, including wrong audiences and insufficient
scopes. Switch only after every downstream receiver accepts the issuer. The core never
retries a failed Keycloak request against Auth0; rolling back is the explicit
`USE_KEYCLOAK=false` change above.

The Express adapter retains string member IDs and never invents a member ID for
a service. All route machine checks use common `hasScopes` with explicit any-scope
alternatives. Missing route scopes deny service access. Authentication errors
become sanitized 401 responses, including services with the older error handler.

Challenge public routes remain anonymous when no valid token is present. A validated
service token with insufficient route scopes receives 403 and cannot bypass challenge
whitelists. Raw scope/permissions claims do not classify identities. Service audit
fields use `service:<clientId>`; service principals have neither member IDs nor handles.
Only member callers are assigned member resources on challenge creation. Project
privilege checks accept verified service identities without inventing a member ID.
Legacy query-token support remains, but query credential fields and URL queries are
excluded from route diagnostics. Remove query-token use from callers during rollout.

Validation: `pnpm test:keycloak` covers the compiled adapter and actual route
middleware with signed RSA tokens. `test/unit/m2m-provider.test.js` (part of `pnpm test`)
checks that `USE_KEYCLOAK=false` or unset sends the Auth0 settings to the token provider
and Bus wrapper, and that `true` sends the Keycloak settings. To test persisted audit attribution, run
`DATABASE_URL=<disposable PostgreSQL URL> node --test test/keycloak-audit.integration.cjs`
after applying the schema to that disposable database. The test creates and removes
its own phase; do not use shared DEV/production databases.

The existing full suite has 248 passing tests and 145 failures. An unchanged
8c77e513 checkout using its original frozen lockfile reproduces all 145 failure
names (241 passing, 152 failing), including validation-message assertions, incomplete
downstream review fixtures, and unconfigured outbound services. Lint/build pass.

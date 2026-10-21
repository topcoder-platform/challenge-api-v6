# Keycloak M2M migration branch

This code is isolated on `keycloak_m2M`. Do not deploy this branch until the
workload and its callers are ready. Existing DEV services continue using Auth0.
The core dependency is pinned to a reviewed Keycloak prerelease commit, including
transitive wrapper uses through the pnpm override. No npm latest dependency is used.

Required settings are `M2M_PROVIDER=keycloak`, `KEYCLOAK_ISSUER`,
`KEYCLOAK_AUDIENCE`, and `KEYCLOAK_TOKEN_URL`; issuing workloads additionally need
`KEYCLOAK_CLIENT_ID` and `KEYCLOAK_CLIENT_SECRET` from their own encrypted secret
references. Optional `KEYCLOAK_SCOPE` narrows the client's approved defaults.
The DEV issuer is `https://keycloak.topcoder-dev.com/realms/topcoder-m2m-dev`,
audience `https://api.topcoder-dev.com`, and managed endpoint
`https://keycloak.topcoder-dev.com/m2m/token`. The managed endpoint passed DEV deployment acceptance; enable this configuration
only with workload-specific grants and rollout approval.

Member sessions remain Auth0. Keep `VALID_ISSUERS` and `AUTH_SECRET` where legacy
member HMAC tokens are supported. Set `AUTH_USER_AUDIENCES` to a JSON array, or
explicitly retain existing user-token audience behavior with
`ALLOW_LEGACY_USER_AUDIENCE=true`. Never apply that exception to M2M tokens.
During an approved overlap, `LEGACY_M2M_ISSUERS` and `LEGACY_M2M_AUDIENCE` allow
old Auth0 machine tokens to pass the same normalizer. Issuance remains Keycloak-only.

`tc-core-library-js` owns signature, issuer, audience, lifetime, and machine/user
classification. Service adapters must use its verified `kind`, `isMachine`, and
`scopes` rather than decode/reclassify claims. Scope guards delegate exact matching
to the library with explicit all/any policy. Existing business roles and documented
scope aliases remain endpoint policy; adding OAuth scopes to a user token never
grants machine access. No permissive fallback or synthetic token path is available.

Before rollout run this project's `nvm use`, `pnpm lint`, `pnpm build`, and targeted
authentication tests. Validate real authorized/unauthorized routes with both a
Keycloak service token and a member token, including wrong audiences and insufficient
scopes. Switch only after every downstream receiver accepts the issuer. Rollback
requires the prior application/dependency and credentials with equivalent grants;
never automatically retry issuance against Auth0.

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
middleware with signed RSA tokens. To test persisted audit attribution, run
`DATABASE_URL=<disposable PostgreSQL URL> node --test test/keycloak-audit.integration.cjs`
after applying the schema to that disposable database. The test creates and removes
its own phase; do not use shared DEV/production databases.

The existing full suite has 248 passing tests and 145 failures. An unchanged
8c77e513 checkout using its original frozen lockfile reproduces all 145 failure
names (241 passing, 152 failing), including validation-message assertions, incomplete
downstream review fixtures, and unconfigured outbound services. Lint/build pass.

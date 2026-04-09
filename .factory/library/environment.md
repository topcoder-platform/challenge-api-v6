# Environment

Environment variables, external dependencies, and setup notes.

**What belongs here:** required env vars, external API URLs, credentials/setup expectations, Node/runtime requirements, read-only source locations.
**What does NOT belong here:** service start/stop commands or ports to manage locally (use `.factory/services.yaml`).

---

## Required Environment

The importer must load `challenge-api-v6/.env.importer.local` for local/dev execution.

Required values:

- `DATABASE_URL` — challenge DB used by `challenge-api-v6`
- `MEMBER_DB_URL` — member lookup DB connection string for target-member resolution during missing-member planning/validation; defaults to `DATABASE_URL` only when that DB can also resolve member data
- `MEMBER_DB_SCHEMA` — schema used for member lookup tables (default behavior is code-defined; validators should set it explicitly when member data is not reachable through the challenge schema)
- `REVIEW_DB_URL` — review DB used for submissions and review summations
- `RESOURCES_API_URL` — base URL for Resource API writes and reads
- `SUBMISSION_ARCHIVE_DIR` — local directory where submission archive zip files are created during submission URL backfill / targeted reruns
- `AUTH0_URL`
- `AUTH0_AUDIENCE`
- `AUTH0_CLIENT_ID`
- `AUTH0_CLIENT_SECRET`

Optional / useful values:

- `DATA_DIRECTORY=/mnt/Informix`
- importer-scoped attribution values such as `CREATED_BY` / `UPDATED_BY`

`SUBMISSION_ARCHIVE_DIR` must point at a writable local folder. Generated archives are local-only for this mission; workers must not upload them or assume the S3 path in `submission.url` is live.

## Canonical API Endpoints For Validation

- Challenge API base URL: `https://api.topcoder-dev.com/v6/challenges`
- Resource API base URL: read from `RESOURCES_API_URL` in `.env.importer.local`

Workers and validators should use these canonical endpoints rather than probing localhost guesses when validating against the populated dev environment.

## Runtime Boundaries

- `/mnt/Informix` is a read-only legacy data source.
- Existing v6 marathon matches are backfill-only at the challenge level.
- Follow-up targeted rerun mode may overwrite only challenge descriptions plus submission archive/url data, and only when explicitly invoked with an existing challenge-id override.
- Do not commit secrets from `.env.importer.local`.
- The validation target is the existing dev environment referenced by the env file; workers should not assume they are allowed to start replacement local services.

## Node / Tooling Versions

- Repo root (`challenge-api-v6`): Node `22.19.0`
- `challenge-api-v6/data-migration`: Node `18.19.0`
- `pnpm` is installed and available (`10.32.1` during planning)

Workers switching between repo root and `data-migration/` must switch Node versions in the same shell command.

## Existing Local Processes Observed During Planning

These are informational boundaries for worker safety:

- port `3100` already has a running process; do not kill or repurpose it unless the user later explicitly asks
- local postgres is already listening on `54329`; only use it if the env file points there

## Source Data Notes

- Marathon matches come from legacy `round` rows with `round_type_id='13'`.
- Primary join path: `round -> long_component_state -> long_submission -> long_comp_result`.
- Challenge description backfill uses the legacy `round -> component -> problem` mapping and reads raw `problem.problem_text`.
- `round_registration_*.json` is the source of submitter resources.
- Submission archive content comes from legacy submission text fields associated with the imported non-example submissions.
- `user_*.json` resolves `coder_id` identities.

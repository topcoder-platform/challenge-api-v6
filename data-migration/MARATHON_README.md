# Historical Marathon Match Import

This document covers how to configure, dry-run, validate, and apply the
`importHistoricalMarathonMatches.js` importer.

Commands below assume you are running from the `challenge-api-v6` repository
root.

## What the script does

`data-migration/src/scripts/importHistoricalMarathonMatches.js` imports
historical Marathon Match rounds from legacy Informix JSON exports into the v6
challenge stack.

The script can:

- discover an existing v6 Marathon Match challenge and backfill missing data
- create a new Marathon Match challenge and its standard phases when no safe
  match exists
- reconcile submitter resources through the Resources API
- import submission history, final scores, and provisional scores into the
  review database

When the review submission table exposes `systemFileName`, `virusScan`, and
`isFileSubmission`, submission-history reconciliation sets or backfills those
fields to the generated zip filename, `true`, and `true` respectively.

The default mode is `--dry-run`. No writes happen unless `--apply` is provided.

## Required legacy input files

By default the importer expects these files under `DATA_DIRECTORY` or
`--data-dir`:

- `round_1.json`
- `round_component_1.json`
- `component_1.json`
- `problem_1.json`
- `long_component_state_1.json`
- files matching `^round_registration_\d+\.json$`
- files matching `^user_\d+\.json$`
- files matching `^long_submission_\d+\.json$`
- files matching `^long_comp_result_\d+\.json$`

All of those defaults can be overridden with CLI flags if your export filenames
are different.

## Environment configuration

The script automatically loads:

- `challenge-api-v6/.env.importer.local`
- then the normal process environment

Create or update `challenge-api-v6/.env.importer.local` with placeholder values
similar to:

```bash
DATA_DIRECTORY=/mnt/Informix

# v6 challenge database
DATABASE_URL=postgresql://user:password@host:5432/challenge_db

# optional member lookup override; defaults to DATABASE_URL when omitted
MEMBER_DB_URL=postgresql://user:password@host:5432/member_db
MEMBER_DB_SCHEMA=members

# required for apply mode score/submission reconciliation
REVIEW_DB_URL=postgresql://user:password@host:5432/review_db
REVIEW_DB_SCHEMA=reviews

# required for apply mode resource reconciliation
RESOURCES_API_URL=https://api.topcoder-dev.com/v5/resources
AUTH0_URL=https://topcoder-dev.auth0.com
AUTH0_AUDIENCE=https://www.topcoder-dev.com
AUTH0_CLIENT_ID=your-m2m-client-id
AUTH0_CLIENT_SECRET=your-m2m-client-secret

# optional attribution
CREATED_BY=historical-mm-importer
UPDATED_BY=historical-mm-importer

# optional override; defaults to the standard Submitter role
SUBMITTER_ROLE_ID=732339e7-8e30-49d7-9198-cccf9451e221
```

### What is required for each mode

For a useful dry run:

- `DATA_DIRECTORY` or `--data-dir`
- `DATABASE_URL` is strongly recommended so the importer can do authoritative
  v6 discovery and resolve the canonical Marathon Match/Data Science timeline
  template
- `MEMBER_DB_URL` is recommended if member lookup is not in the same database as
  `DATABASE_URL`

Without `DATABASE_URL`, the script can still read the legacy files, but rounds
that need create-path planning will usually stay `unresolved`.

For apply mode:

- `DATABASE_URL`
- `REVIEW_DB_URL`
- `RESOURCES_API_URL`
- `AUTH0_URL`
- `AUTH0_AUDIENCE`
- `AUTH0_CLIENT_ID`
- `AUTH0_CLIENT_SECRET`
- `MEMBER_DB_URL` if member lookup is not available through `DATABASE_URL`

## CLI usage

Basic form:

```bash
node data-migration/src/scripts/importHistoricalMarathonMatches.js \
  --dry-run \
  --round-id <legacyRoundId>
```

Useful options:

- `--round-id <id>`: import a single legacy round, repeatable
- `--round-ids <id1,id2,...>`: import multiple rounds in one run
- `--data-dir <path>`: override the legacy export directory
- `--existing-state-file <path>`: optional offline snapshot for count hints only
- `--skipped-file <path>`: where to write the deterministic skip artifact
- `--apply`: perform writes instead of planning only

Show full help:

```bash
node data-migration/src/scripts/importHistoricalMarathonMatches.js --help
```

## Dry-run workflow

1. Change into the service root and select the repo Node version.

```bash
cd challenge-api-v6
nvm use
```

2. Run a dry run for one round first.

```bash
mkdir -p data-migration/out

node data-migration/src/scripts/importHistoricalMarathonMatches.js \
  --dry-run \
  --round-id 12345 \
  --skipped-file data-migration/out/historical-mm-skipped-12345.json \
  | tee data-migration/out/historical-mm-plan-12345.log
```

3. Review the output.

The script writes one `PLAN_RECORD` per round and a final `PLAN_SUMMARY`, for
example:

- `PLAN_RECORD {...}`
- `PLAN_SUMMARY {...}`

Useful checks:

```bash
rg '^PLAN_SUMMARY ' data-migration/out/historical-mm-plan-12345.log
rg '^PLAN_RECORD ' data-migration/out/historical-mm-plan-12345.log
cat data-migration/out/historical-mm-skipped-12345.json
```

## What to validate before apply

Do not run `--apply` until the dry run looks clean.

Validate these points:

- `PLAN_SUMMARY.countsByDecision.unresolved` is `0`
- `PLAN_SUMMARY.countsByDecision.unmatched` is `0`
- each selected round has a `PLAN_RECORD.decision` of either `create` or
  `reuse/backfill-only`
- `PLAN_RECORD.reason` is expected for that round
- `skippedFileArtifact.recordCount` is understood and acceptable
- `missing-member` entries in the skipped artifact are expected, or the member
  lookup configuration has been fixed
- `finalist-without-attachable-submission` entries have been reviewed against
  the legacy data

Recommended interpretation:

- `create`: the importer plans to create the v6 challenge and standard phases,
  then reconcile resources and review-side data
- `reuse/backfill-only`: a safe existing v6 challenge match was found, so the
  importer will only backfill missing linked data
- `unresolved`: configuration or data prerequisites are missing; fix these
  before apply
- `unmatched`: the selected round was not found in the legacy source set

If you want the plan to use direct v6 counts rather than snapshot hints, make
sure the dry run can reach `DATABASE_URL`, and optionally `REVIEW_DB_URL` and
`RESOURCES_API_URL`.

## Apply workflow

After the dry run has been reviewed and accepted, rerun the same selection with
`--apply`.

```bash
node data-migration/src/scripts/importHistoricalMarathonMatches.js \
  --apply \
  --round-id 12345 \
  --skipped-file data-migration/out/historical-mm-skipped-12345.json \
  | tee data-migration/out/historical-mm-apply-12345.log
```

Apply mode still prints structured output:

- `APPLY_RECORD {...}`
- `APPLY_SUMMARY {...}`

Review it with:

```bash
rg '^APPLY_SUMMARY ' data-migration/out/historical-mm-apply-12345.log
rg '^APPLY_RECORD ' data-migration/out/historical-mm-apply-12345.log
cat data-migration/out/historical-mm-skipped-12345.json
```

Expected apply result:

- `APPLY_SUMMARY.errors` is `0`
- `APPLY_SUMMARY.unresolved` is `0`
- `APPLY_SUMMARY.unmatched` is `0`
- rounds show `created` or `existing` status as expected

## Rerun operator workflows

### Standard full apply rerun

Use this when you want to rerun full reconciliation for a round that was
already imported/backfilled:

```bash
node data-migration/src/scripts/importHistoricalMarathonMatches.js \
  --apply \
  --round-id <legacyRoundId> \
  --skipped-file data-migration/out/historical-mm-skipped-<legacyRoundId>.json
```

Expected rerun behavior:

- reruns are idempotent: already-imported records are reconciled as existing
  instead of duplicated
- existing submissions are backfilled with deterministic `systemFileName`,
  `virusScan=true`, and `isFileSubmission=true` when the review schema exposes
  those columns
- if legacy provisional rows are malformed, they are skipped/reported (not
  fatal) with `reasonCode=malformed-provisional-score` in the skipped artifact;
  apply reruns continue and still complete successfully
- existing `missing-member` skips remain deterministic and rerun-stable for
  members still absent from the target environment

### Targeted rerun patch mode (description + submission archive/url only)

Targeted rerun is explicit patch mode for already-imported rounds. It requires:

- `--apply --targeted-rerun --round-id <id> --challenge-id <challengeId>`
- exactly one selected round
- the selected round to resolve an existing imported v6 challenge; if full planning
  is blocked only by `target-member-resolution-unavailable`, targeted rerun can
  still proceed because it patches only description and submission archive/url data
- a writable `SUBMISSION_ARCHIVE_DIR` (used to generate local zip archives)

Canonical command shape:

```bash
node data-migration/src/scripts/importHistoricalMarathonMatches.js --apply --targeted-rerun --round-id <id> --challenge-id <challengeId>
```

1. Look up the existing challenge id by legacy round id:

```bash
curl -s "https://api.topcoder-dev.com/v6/challenges?legacyId=<legacyRoundId>" \
  | jq -r '.[0].id'
```

2. Ensure `SUBMISSION_ARCHIVE_DIR` is configured and writable (export in-shell
if needed, instead of editing committed env files):

```bash
export SUBMISSION_ARCHIVE_DIR=/tmp/mm-submission-archives
mkdir -p "$SUBMISSION_ARCHIVE_DIR"
```

3. Run targeted rerun with explicit override:

```bash
node data-migration/src/scripts/importHistoricalMarathonMatches.js \
  --apply \
  --targeted-rerun \
  --round-id <legacyRoundId> \
  --challenge-id <challengeId> \
  --skipped-file data-migration/out/historical-mm-skipped-<legacyRoundId>.json
```

Description source precedence in targeted rerun:

1. use raw legacy `problem.problem_text` only when it contains renderable HTML
2. otherwise use Markdown converted from legacy `component.component_text` XML
3. if neither source is usable, preserve the existing description

Description writes also set `descriptionFormat` deterministically:

- `html` when raw legacy `problem.problem_text` HTML is used
- `markdown` when converted `component.component_text` content is used or when
  fallback importer text is stored

Targeted rerun is patch-only and idempotent:

- it may patch only challenge `description` and submission archive/url data
- it must not mutate phases, resources, or review-summation identities
- rerunning the same targeted patch converges without creating duplicates

## Recommended rollout sequence

1. Run `--dry-run` for a single round.
2. Validate the `PLAN_RECORD`, `PLAN_SUMMARY`, and skipped artifact.
3. Run `--apply` for that same single round.
4. Validate the `APPLY_RECORD`, `APPLY_SUMMARY`, and target-system data.
5. Repeat with the next round, or run a controlled batch with `--round-ids`.

## Notes and pitfalls

- The skipped artifact path defaults to
  `./historical-mm-skipped-<rounds>.json` relative to the current working
  directory. Use `--skipped-file` if you want a predictable location.
- `--existing-state-file` is only a hint source for offline planning. It is not
  authoritative reuse matching.
- Apply mode requires write-capable connectivity to the challenge database, the
  review database, and the Resources API.
- If `REVIEW_DB_URL` is missing, apply mode will fail before submission, final
  score, or provisional score import starts.
- If `RESOURCES_API_URL` or Auth0 credentials are missing, apply mode will fail
  before participant reconciliation starts.

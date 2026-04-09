# Architecture

How the historical marathon-match importer works at a high level.

**What belongs here:** major components, branch behavior, data flow, invariants, and cross-service ownership.
**What does NOT belong here:** step-by-step implementation tasks or validator commands.

---

## System Boundary

The mission adds a reusable importer inside `challenge-api-v6/data-migration/` that reads legacy Informix JSON exports and reconciles them into the v6 challenge/resource/review stack.

### Read surfaces

- `/mnt/Informix` JSON exports (read-only)
- existing v6 challenge data through the challenge DB / challenge-api schema
- existing v6 resource data through the Resource API
- existing v6 submission and review-summation data through the review DB / review-api schema
- local env configuration from `.env.importer.local`, including `SUBMISSION_ARCHIVE_DIR`

### Write surfaces

- Challenge and ChallengePhase records in the challenge DB
- submitter Resource records through the Resource API
- Submission and ReviewSummation records in the review DB
- local submission archive zip files under `SUBMISSION_ARCHIVE_DIR`

## Import Pipeline

### 1. Selection and planning

The importer accepts an explicit round filter and builds a per-round plan. Each selected round is classified as one of:

- `create` — no matching v6 marathon challenge exists
- `reuse/backfill-only` — a v6 marathon challenge already exists and only linked records may be added
- `skip` / `unresolved` — the round cannot be safely applied without more input

Planning is required to surface traceability, counts, and entity-level deltas before writes occur.

`--existing-state-file` is supplemental only. It may enrich counts for reporting, but it is not authoritative reuse evidence and must never override direct challenge-state discovery.

### Existing-challenge match rule

Safe reuse is authoritative, not fuzzy:

1. first try an exact existing `challenge.legacyId == round.id` match
2. if there is not exactly one such match, treat any name-based or heuristic candidates as planning diagnostics only
3. before reusing a matched challenge, verify it is a safe historical MM target: Marathon Match type, Data Science track, and no conflicting duplicate standard phase rows
4. if the round still is not matched unambiguously, or if the matched challenge fails those shape checks, emit `unresolved` and require an explicit override rather than auto-reusing a challenge

This keeps backfill-only behavior deterministic and avoids silent challenge-level rewrites.

If authoritative challenge-state discovery is unavailable, planning must fail closed as `unresolved` instead of silently falling back to create-path planning.

### 2. Challenge reconciliation

For each selected round:

- if no v6 challenge exists, create one completed `Marathon Match` challenge on the `Data Science` track
- if a v6 challenge is matched unambiguously and passes the reuse preconditions above, keep the same challenge id and preserve challenge-level fields

Created challenges must use `challenge.legacyId = round.id`. Reused challenges are not challenge-level rewrite candidates; they must already be matched unambiguously by the rule above or remain `unresolved`.

### Challenge description sourcing

Challenge description content comes from the legacy `round -> component -> problem` mapping:

- when a selected round maps to a legacy `problem` row with non-empty `problem_text`, persist that raw HTML as the v6 challenge description
- when no problem row or no usable `problem_text` is available, retain the existing placeholder/fallback description behavior
- on standard reuse/backfill runs, preserve existing challenge-level fields other than the approved follow-up description patch
- on targeted rerun patch mode, description overwrite is allowed only when the caller provides an explicit existing challenge-id override

### 3. Phase materialization

Canonical MM history in v6 is represented by exactly three standard phases:

- `Registration`
- `Submission`
- `Review`

For newly created historical challenges, these phases must exist and be closed. For reused challenges, already-present standard phase rows are preserved as-is and only absent standard phase rows may be added.

### Timeline derivation rule

When creating a historical challenge:

- choose the canonical Marathon Match/Data Science timeline mapping used by the target environment by resolving exactly one valid template candidate; if zero or multiple candidates remain, stop with `unresolved`
- derive `Registration` from the min/max eligible `round_registration.timestamp`
- derive `Submission` from the earliest available legacy submission-open signal for the round, falling back to the earliest non-example submit timestamp when needed, and end it at the latest non-example submit timestamp
- synthesize `Review` as a coherent closed interval starting at or after the imported submission end; if no explicit review timestamps exist, collapse it to a closed interval at the end of submission rather than inventing a separate open window

If required timestamps are missing or contradictory enough that a coherent closed timeline cannot be produced, the round should remain `unresolved` instead of being half-created.

Planning must perform this same canonical MM/Data Science timeline-mapping resolution before returning `decision=create`; dry-run must not promise creates that apply would later reject.

### 4. Participant materialization

Submitter resources come from legacy registrations, not just from members with submissions. The importer must create or reuse exactly one submitter-role resource per eligible registrant that resolves in the target environment.

**Eligible registrant rule:** every distinct `round_registration.coder_id` for the selected round where `eligible == '1'`.

**Identity normalization rule:** resolve each legacy `coder_id` once through the same normalized member lookup and reuse that normalized identity for Resource API writes, imported submissions, and imported review records so the same member cannot surface with conflicting cross-service identities.

**Stable resource dedup key:** `(challengeId, memberId, roleId=submitter)`.

### Missing-member skip policy

If the target dev environment does not contain a legacy member, classify that member as `missing-member` for the current run and:

- skip resource creation for that member
- skip that member's non-example submissions
- skip that member's final and provisional review materialization
- continue importing other members for the round
- write a deterministic skipped-file artifact for later manual processing

The skipped artifact should be stable enough for rerun comparison and manual recovery, including at least the legacy round id, member id, skip reason, and affected surfaces.

### Approved completed-challenge resource workflow

If the Resource API refuses submitter creation on a completed historical challenge, the user has approved a temporary status-transition workflow solely for submitter-resource backfill:

- capture the original challenge status first
- transition only as much as needed to satisfy the Resource API write constraint
- create the missing submitter resources through the Resource API
- restore the challenge to its original completed state before the importer finishes

This workflow is a narrow exception for historical resource backfill only; it does not authorize general challenge-level rewrites.

### 5. Submission materialization

Only non-example legacy submissions are imported. The importer must preserve the full non-example history for members that resolve in the target environment, and explicitly skip/report missing-member rows instead of creating partial participant footprints.

**Stable submission identity invariant:** imported `Submission.legacySubmissionId` must be a deterministic composite derived from legacy submission identity so round-wide and rerun validation can compare exact sets. The contract assumes `legacySubmissionId` is the stable external identity for imported submissions.

### Submission archive backfill

Imported/reused submissions also participate in a deterministic archive backfill flow:

- load legacy submission text from the same submission identity used for `legacySubmissionId`, preferring the main long-submission text field and only falling back to secondary legacy text fields when needed
- build a deterministic archive filename from stable submission identity so reruns converge on the same local file and the same `submission.url`
- write a zip file containing a single text file with the recovered legacy submission text under `SUBMISSION_ARCHIVE_DIR`
- set `submission.url` to the delayed-upload target format `https://s3.amazonaws.com/topcoder-submissions/<archive-file-name>`
- on reruns, treat archive generation plus URL update as reconciliation work: recreate/refresh only as needed without duplicating submission rows

### 6. Score materialization

Two score streams are imported:

- **provisional history** — one provisional review summation per imported non-example submission, using `long_submission.submission_points`
- **final result** — one final review summation per imported member, attached to that member's latest imported non-example submission

Final-score derivation uses legacy final-result fields with the agreed precedence:

1. `long_comp_result.system_point_total`
2. `long_comp_result.point_total`
3. the ranking score from legacy state data used for final ordering

If a legacy finalist has no imported non-example submission to attach to, the importer must skip that final score explicitly rather than create an orphan final review summation. Missing-member skips should be reported distinctly from other skip reasons.

**Stable review-summation dedup keys:**

- provisional: exactly one provisional review summation per imported submission (`submissionId + provisional`)
- final: exactly one final review summation on the member's latest imported non-example submission (`submissionId + final`)

## Reuse / Backfill Rules

These are core safety invariants:

- existing v6 marathon challenges are source of truth for challenge-level fields
- backfill may add missing linked records only
- the approved follow-up patch mode may additionally overwrite challenge `description` and submission archive/url data, but nothing else
- already-present standard phase rows on reused challenges are preserved
- reruns must not duplicate challenges, phases, resources, submissions, or review summations
- example submissions and example review summations are never imported

## Apply / Resume Behavior

Cross-service writes are not a single distributed transaction. The importer therefore must be round-scoped and restart-safe:

- plan a round before applying it
- read before write on every owned surface
- treat rerun reconciliation as the recovery path after partial failure
- never assume a round is absent just because a previous apply stopped mid-flight

The observable result of rerunning a partially imported round should be reconciliation to the same steady state, not duplication or destructive rewrite.

If a temporary status-transition workflow is used during participant backfill, reruns must still converge to the same final completed state.

Targeted rerun patch mode is deliberately narrow and explicit:

- it requires an explicit existing challenge-id override
- it may patch only the challenge description plus submission archive/url data for the selected round
- it must not recreate submissions or mutate resource/review/phase state outside the approved patch surfaces

## Data Ownership Invariants

### Challenge DB

Owns:

- challenge identity and completion state
- phase rows and challenge timeline shape

### Resource API

Owns:

- submitter resource creation/reuse
- externally visible `(memberId, roleId)` participant footprint

### Review DB / Review API

Owns:

- imported submissions
- provisional review summations per submission
- final review summations attached to the latest imported non-example submission per member
- the `submission.url` field pointing at the deterministic archive path

### Local filesystem (`SUBMISSION_ARCHIVE_DIR`)

Owns:

- generated zip archives for legacy submission text
- deterministic archive filenames used to derive `submission.url`

## Validation-Oriented Invariants

The validation contract relies on these high-level invariants being preserved:

- round `10815` is the primary missing-historical create-path fixture
- a score-rich Marathon Match fixture is selected during score-feature work for final-ranking validation
- round `14272` is the second selected round for multi-round blast-radius checks
- imported submission identity is externally testable via `legacySubmissionId`
- imported description sourcing is externally testable via raw HTML challenge description reads
- imported archive backfill is externally testable via `submission.url` plus local zip inspection
- reused-round verification depends on comparing both identity sets and externally visible field snapshots
- for member-owned surfaces, validation now reconciles `imported subset + skipped missing-member subset = legacy total`

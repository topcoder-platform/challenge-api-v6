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

### Write surfaces

- Challenge and ChallengePhase records in the challenge DB
- submitter Resource records through the Resource API
- Submission and ReviewSummation records in the review DB

## Import Pipeline

### 1. Selection and planning

The importer accepts an explicit round filter and builds a per-round plan. Each selected round is classified as one of:

- `create` — no matching v6 marathon challenge exists
- `reuse/backfill-only` — a v6 marathon challenge already exists and only linked records may be added
- `skip` / `unresolved` — the round cannot be safely applied without more input

Planning is required to surface traceability, counts, and entity-level deltas before writes occur.

### Existing-challenge match rule

Safe reuse is authoritative, not fuzzy:

1. first try an exact existing `challenge.legacyId == round.id` match
2. if there is not exactly one such match, treat any name-based or heuristic candidates as planning diagnostics only
3. before reusing a matched challenge, verify it is a safe historical MM target: Marathon Match type, Data Science track, and no conflicting duplicate standard phase rows
4. if the round still is not matched unambiguously, or if the matched challenge fails those shape checks, emit `unresolved` and require an explicit override rather than auto-reusing a challenge

This keeps backfill-only behavior deterministic and avoids silent challenge-level rewrites.

### 2. Challenge reconciliation

For each selected round:

- if no v6 challenge exists, create one completed `Marathon Match` challenge on the `Data Science` track
- if a v6 challenge is matched unambiguously and passes the reuse preconditions above, keep the same challenge id and preserve challenge-level fields

Created challenges must use `challenge.legacyId = round.id`. Reused challenges are not challenge-level rewrite candidates; they must already be matched unambiguously by the rule above or remain `unresolved`.

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

### 4. Participant materialization

Submitter resources come from legacy registrations, not just from members with submissions. The importer must create or reuse exactly one submitter-role resource per eligible registrant.

**Eligible registrant rule:** every distinct `round_registration.coder_id` for the selected round where `eligible == '1'`.

**Identity normalization rule:** resolve each legacy `coder_id` once through the same normalized member lookup and reuse that normalized identity for Resource API writes, imported submissions, and imported review records so the same member cannot surface with conflicting cross-service identities.

**Stable resource dedup key:** `(challengeId, memberId, roleId=submitter)`.

### 5. Submission materialization

Only non-example legacy submissions are imported. The importer must preserve the full non-example history per member.

**Stable submission identity invariant:** imported `Submission.legacySubmissionId` must be a deterministic composite derived from legacy submission identity so round-wide and rerun validation can compare exact sets. The contract assumes `legacySubmissionId` is the stable external identity for imported submissions.

### 6. Score materialization

Two score streams are imported:

- **provisional history** — one provisional review summation per imported non-example submission, using `long_submission.submission_points`
- **final result** — one final review summation per member, attached to the member's latest imported non-example submission

Final-score derivation uses legacy final-result fields with the agreed precedence:

1. `long_comp_result.system_point_total`
2. `long_comp_result.point_total`
3. the ranking score from legacy state data used for final ordering

If a legacy finalist has no imported non-example submission to attach to, the importer must skip that final score explicitly rather than create an orphan final review summation.

**Stable review-summation dedup keys:**

- provisional: exactly one provisional review summation per imported submission (`submissionId + provisional`)
- final: exactly one final review summation on the member's latest imported non-example submission (`submissionId + final`)

## Reuse / Backfill Rules

These are core safety invariants:

- existing v6 marathon challenges are source of truth for challenge-level fields
- backfill may add missing linked records only
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

## Validation-Oriented Invariants

The validation contract relies on these high-level invariants being preserved:

- round `9892` is the primary missing-historical create-path fixture
- round `10089` is the score-rich final-ranking fixture
- round `14272` is the second selected round for multi-round blast-radius checks
- imported submission identity is externally testable via `legacySubmissionId`
- reused-round verification depends on comparing both identity sets and externally visible field snapshots

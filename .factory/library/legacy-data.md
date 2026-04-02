# Legacy Data

Legacy source facts that workers should reuse instead of rediscovering.

**What belongs here:** source tables/files, join paths, score-source facts, and fixture-round notes.
**What does NOT belong here:** v6 write-side implementation steps.

---

## Primary Files

- `round_1.json`
- `round_registration_*.json`
- `long_component_state_1.json`
- `long_submission_*.json`
- `long_comp_result_*.json`
- `user_*.json`

## Marathon Match Identification

- Marathon matches are legacy `round` rows with `round_type_id='13'`.
- Planning discovered `309` MM rounds in the available export set.

## Join Path

Use this legacy relationship when deriving participant/submission/final-score data:

- `round -> long_component_state -> long_submission -> long_comp_result`

## Resource Source

- submitter resources come from `round_registration_*.json`
- resources are registration-driven, not submission-driven
- eligible registrants are rows where `round_registration.eligible == '1'`

## Submission Rules

- import full **non-example** history only
- example submissions are excluded from imported submissions and imported score history
- imported `Submission.legacySubmissionId` must be deterministic and stable across reruns

### Named participant fixture

- round `10815`, member `22664170` (`Marinov_Martin`):
  - `27` non-example submissions
  - `55` example runs
  - latest non-example submit timestamp: `1180539064719`

## Score Rules

### Provisional

- source: `long_submission.submission_points`
- cardinality: one provisional review summation per imported non-example submission

### Final

- source precedence:
  1. `long_comp_result.system_point_total`
  2. `long_comp_result.point_total`
  3. ranking score from legacy state data used for final ordering
- attachment target: latest imported non-example submission for the member
- if no non-example submission exists, skip explicitly; do not create orphan finals

## Fixture Rounds

- `10815`: `836` eligible registrations, `1445` non-example submissions, `2424` example submissions, `267` submitters with non-example history, and fallback-heavy final-score behavior; in the current target-member snapshot this round plans `283` final candidates split into `266` importable finals, `2` missing-member final skips, and `15` explicit `finalist-without-attachable-submission` skips. Treat this as the selected unattachable-finalists fixture for score validation.
- `17948`: selected score-rich Marathon Match fixture for final-score validation. Current planning/apply evidence for this round yields `81` legacy final candidates with `45` importable finals, `36` `missing-member` final skips, and `0` explicit `finalist-without-attachable-submission` skips. Imported finals on this fixture are `system_point_total`-backed and preserve legacy placement order when sorted by aggregate score descending after excluding missing-member finalists.
- `13897`: remains a useful large MM backfill fixture, but it is **not** the selected score-rich placement fixture because it currently includes `33` explicit `finalist-without-attachable-submission` skips.
- `14272`: second selected-round filter fixture; current validation guidance treats it as an unresolved/non-Marathon-Match round rather than an importable Marathon Match target
- `10089` and `10722` remain non-Marathon in current planning and should not be used as Marathon Match score fixtures.

## Existing-State Snapshot File (`--existing-state-file`)

- Purpose: optional offline count hints for reporting only
- Authoritative source of truth: direct challenge-state discovery through the challenge DB / challenge-api schema
- Non-authoritative rule: this file must never override create vs reuse/backfill classification

### How validators can create one

There is no committed generator script. When a validator explicitly needs to exercise the supplemental snapshot path, create a small hand-authored JSON file from prior read-only API or DB observations, for example:

```bash
cat > /tmp/existing-state.json <<'JSON'
{
  "rounds": {
    "10815": {
      "challengeId": "5fa76bd9-da55-422d-8d4c-4f0155dc62c5",
      "existing": {
        "phases": 3,
        "resources": 57,
        "submissions": 0,
        "finalScores": 0,
        "provisionalScores": 0
      }
    }
  }
}
JSON
```

### Accepted schema

- top-level object
- either:
  - `{"rounds": [{"legacyRoundId": "...", "challengeId": "...", "existing": {...}}]}`
  - `{"rounds": {"10815": {"challengeId": "...", "existing": {...}}}}`
  - or a plain object keyed by legacy round id
- each entry may contain:
  - `challengeId`
  - `existing.phases`
  - `existing.resources`
  - `existing.submissions`
  - `existing.finalScores`
  - `existing.provisionalScores`

Invalid or mismatched counts should affect only supplemental reporting, never authoritative reuse matching.

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

- `9892`: `1108` eligible registrations, `3217` non-example submissions, `2381` example submissions, `354` submitters with non-example history
- `10089`: clean final-score round with `115` non-null `system_point_total` finalists
- `14272`: second multi-round blast-radius fixture with `3326` non-example submissions
- `10722`: useful edge-case round for finalists without attachable non-example submissions and duplicate placements

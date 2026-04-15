# User Testing

Validation surface findings, setup expectations, and concurrency guidance.

**What belongs here:** validation surfaces, required tools, setup notes, fixture rounds, and concurrency limits.
**What does NOT belong here:** implementation details or feature decomposition.

---

## Validation Surface

### Surface: Importer CLI + API verification

Primary validation is black-box and uses:

- importer CLI (`node ...`)
- `curl` against Challenge API / Resource API / Review API
- `python` for read-only comparison against `/mnt/Informix`

There is no browser or TUI surface for this mission.

### Expected validation flow

1. Run importer dry-run for a selected round set.
2. Capture per-round decision records and deltas.
3. Run apply for the same selected round set.
4. Verify challenge/resource/submission/review state through API responses.
5. For follow-up patch validation, inspect local archive files under `SUBMISSION_ARCHIVE_DIR` and compare their contents to legacy submission text.
6. Inspect the skipped-file artifact for any missing-member records reported by the run.
7. Compare imported data plus skipped-member reporting to legacy data using read-only Python scripts.
8. Re-run apply or dry-run to prove idempotency / patch-only behavior.

Canonical live validation endpoints:

- Challenge API: `https://api.topcoder-dev.com/v6/challenges`
- Resource API: from `RESOURCES_API_URL` in `.env.importer.local`

If participant backfill uses the approved temporary status-transition workflow, validators should verify the post-apply state only: the challenge must end in its original completed state after Resource API writes finish.
If the approved missing-member policy is exercised, validators should reconcile `imported + skipped = legacy total` on member-owned surfaces and verify the skipped-file artifact records the skipped members and reason codes.

### Fixture rounds

- `10815` — primary create-path round during planning-challenge; in the shared dev environment it is now a post-create/backfill fixture
- one score-rich Marathon Match round selected during score-feature work for final-ranking validation
- `10015` when available — already-imported description-backfill / targeted-rerun fixture
- `10758` — create-path XML-to-Markdown description-fallback fixture (`problem_text` empty, `component_text` present)
- `14272` — second round for multi-round filter checks
- one existing-v6 round chosen from dry-run output in the validation environment
- one Marathon Match round with unattachable finalists selected during score-feature work for explicit skip/report validation

## Validation Concurrency

### Surface: importer CLI + API verification

- **Max concurrent validators:** `5`
- **Rationale:** machine inspection during planning showed `32` CPUs, `46.83 GB` total RAM, and `32.25 GB` available RAM. Using the required 70% headroom rule gives about `22.58 GB` usable headroom. CLI + `curl` + `python` validators are lightweight and mostly share the same external services, so even five concurrent validators remain comfortably within CPU and memory budget.
- **Practical note:** concurrency should still be reduced if validators must run apply-mode writes against the same validation rounds; prefer partitioning by round or by assertion group to avoid data races.

## Readiness Notes

- Validation uses the existing dev environment referenced by `.env.importer.local`.
- `.env.importer.local` is populated, so live end-to-end apply-mode validation can proceed on the selected dev environment.
- `SUBMISSION_ARCHIVE_DIR` must point at a writable local directory before follow-up targeted rerun validation can pass.
- If `SUBMISSION_ARCHIVE_DIR` is missing from `.env.importer.local`, validators may export a writable override in the same shell command for live targeted-rerun validation instead of editing the env file.
- Follow-up user-testing round 2 on `2026-04-15` confirmed that apply-mode importer connectivity to the configured challenge/review databases is restored: positive targeted reruns succeeded for round `17948`, create-path XML-fallback validation succeeded for round `10758`, and targeted-rerun XML-fallback validation succeeded for round `13897`.
- Round `10015` is not currently imported in the shared dev environment, so successful raw-HTML targeted-rerun validation now uses round `17948` as the live fallback fixture.
- The only remaining follow-up blocker is fixture availability for `VAL-FOLLOWUP-005`: export-wide search found `237` no-source Marathon Match rounds in `/mnt/Informix`, but none of them are already imported in the shared environment.
- Pre-existing repo-wide `standard-lint` noise in `challenge-api-v6` should not be mistaken for importer regressions; validators should focus on mission-owned surfaces.
- The shared dev environment does not necessarily contain every historical legacy member id, so member-owned validation must account for approved `missing-member` skips rather than assuming full one-to-one import coverage.
- If dry-run/apply returns `target-member-resolution-unavailable`, the validation environment still lacks reachable member lookup configuration. Provide `MEMBER_DB_URL` (or a `DATABASE_URL` that can resolve members) plus a valid `MEMBER_DB_SCHEMA` before expecting populated missing-member partitions or skipped-file records from live runs.

## Flow Validator Guidance: importer CLI + API verification

- Treat `legacyId=13897` / challenge `a15cbb04-a0d3-4647-85bd-23d8d11e9f3f` as an already-imported shared-environment fixture. Use it for reuse/rerun and post-import property checks only; do not attempt destructive cleanup or concurrent apply-mode validation against it.
- Round `10815` was imported during planning-challenge user-testing round 2 as challenge `5fa76bd9-da55-422d-8d4c-4f0155dc62c5`. In the shared dev environment it is now a post-create fixture rather than a pristine missing-historical round, so future validators should not expect pre-apply create-path evidence there unless they use a clean/reset environment.
- Immediate rerun dry-run on `10815` now reports `reuse/backfill-only` with `phases.toCreate=0`, but still classifies the round as `partial-backfill` because resources/submissions/finalScores/provisionalScores remain pending later-milestone work. Use it to verify challenge/phase reuse only, not full-surface no-op reruns.
- In the current shared dev environment, `13897` is now a fully imported rerun fixture whose description was updated to converted `component_text` Markdown during follow-up user-testing round 2. Use it for rerun/idempotency/archive checks, not as a placeholder-description candidate.
- `GET https://api.topcoder-dev.com/v6/challenges` and `GET https://api.topcoder-dev.com/v6/challenges/<id>` work without auth in this environment. `GET https://api.topcoder-dev.com/v6/resources?challengeId=<id>` and `GET https://api.topcoder-dev.com/v6/submissions?challengeId=<id>` are also readable without auth.
- Follow-up description validation should read `GET /v6/challenges/<id>` before and after the targeted rerun and compare the raw HTML `description` field directly.
- `GET https://api.topcoder-dev.com/v6/reviewSummations?challengeId=<id>` requires an M2M bearer token. Source `.env.importer.local`, run `node get_token.js`, and use the final stdout line as the token value.
- Response shapes are mixed: challenge/resource lookups return arrays directly, while `submissions` and authenticated `reviewSummations` return paginated objects with `data` and `meta`. Validators should count rows from the `data` array and set a large `perPage` value (for example `1000` or higher) before reconciling totals.
- Follow-up submission-archive validation should read submissions before and after the rerun, record URL deltas, and inspect at least one generated zip file locally to confirm it contains the expected legacy submission text. In this environment the submissions API does not reliably expose the persisted `url`, so URL-specific assertions should use review DB snapshots or equivalent read-only DB evidence.
- XML-fallback description validation should use round `10758` only when a clean create-path fixture is available. In the current shared environment, round `10758` has already been imported as challenge `324a7cf2-f967-4578-9012-55be2730e2b0` with converted Markdown, so future create-path checks must use saved evidence or another clean fixture.
- Round `13897` should no longer be treated as a preserve-with-no-source follow-up fixture and no longer has the placeholder description in the shared environment; round-2 targeted rerun validation updated it to usable converted `component_text` Markdown.
- Current export-backed already-imported XML-fallback placeholder candidate is `9874`; `9892` is `round_type_id=15` and should not be used as a Marathon Match follow-up fixture.
- There is currently no already-imported exported Marathon Match round that satisfies the no-source preserve precondition for `VAL-FOLLOWUP-005`.
- Patch-only rerun validation must capture resource / submission-count / review-count snapshots before and after the rerun and show that only description plus submission URL/archive surfaces changed.
- When participant backfill encounters legacy members absent from the dev environment, validators should expect a skipped-file artifact and should confirm that the skipped member ids plus the imported member-owned records reconcile back to the legacy totals for the round.
- Round `14272` currently dry-runs as `decision=unresolved` with reason `selected-round-round-type-is-not-marathon-match`; it remains useful for exact-filter and unresolved-path validation but should not be treated as an importable Marathon Match fixture.
- The approved follow-up rerun mode must fail closed without an explicit challenge-id override; validators should include one negative-path run that omits the override and confirm no writes occur.
- Previously considered score candidates such as `10089` and `10722` should not be assumed valid Marathon Match fixtures in the current validation environment unless a later score-feature investigation reconfirms them.
- Dry-run planning against `/mnt/Informix` can take several minutes; use generous timeouts (roughly 360-480s) for evidence-capture runs to avoid false timeout failures.
- Do not run apply-mode validators concurrently on the same round or shared dev database. Read-only dry-run/API checks may run concurrently only when they avoid rounds being mutated by another validator.

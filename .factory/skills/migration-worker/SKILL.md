---
name: migration-worker
description: Build and verify historical marathon-match importer features in challenge-api-v6/data-migration with real legacy-data reconciliation and cross-service validation.
---

# Migration Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the work procedure for importer features.

## When to Use This Skill

Use this skill for features that add or modify:

- importer planning / dry-run behavior
- challenge and phase reconciliation logic
- resource derivation and Resource API writes
- submission import and stable legacy submission identity
- final/provisional score import
- importer-focused tests, fixtures, and validation helpers inside `challenge-api-v6/data-migration`

## Required Skills

None.

## Work Procedure

1. Read the assigned feature, `mission.md`, `validation-contract.md`, `AGENTS.md`, `.factory/library/architecture.md`, `.factory/library/environment.md`, `.factory/library/legacy-data.md`, and `.factory/library/user-testing.md` before changing code.
2. Identify which validation-contract assertion IDs the feature fulfills and restate them in your own notes before editing. If the feature description and the contract seem inconsistent, return to the orchestrator.
3. Switch to the correct Node version in the same shell command before running anything:
   - repo root: `nvm use`
   - `data-migration/`: `nvm use 18.19.0`
4. If you are resuming an interrupted feature and the relevant implementation/tests are already on `HEAD`, verify that existing work against the contract first instead of restarting the red/green loop from scratch. Record in the handoff that this was a resume-validation case and cite the commit or files you validated.
5. Otherwise, write tests first (red) for the behavior you are adding. Prefer `data-migration/test/**` for unit/integration tests that exercise:
   - round planning and filtering
   - deterministic `legacySubmissionId`
   - create vs reuse/backfill-only reconciliation
   - score derivation and attachment
   - idempotent reruns
6. Run the new tests and confirm they fail before implementing. Record the exact failing command and observation in the handoff.
7. Implement the minimal code needed to satisfy the feature. Keep write paths aligned with architecture boundaries:
   - challenge / phase writes in the challenge DB
   - resource writes through the Resource API
   - submission / review-summation writes in the review DB
8. Preserve mission invariants while implementing:
   - existing v6 marathon challenges are challenge-level source of truth
   - already-present standard phase rows on reused challenges are preserved
   - example submissions and example review summations are never imported
   - imported submissions expose stable `legacySubmissionId`
   - reruns must not create duplicates or rewrite preserved records
9. After implementation or resume-validation, run targeted validators from `.factory/services.yaml`:
   - `commands.test`
   - `commands.lint`
   - if you touched repo-root code outside `data-migration/`, also run `commands.root_smoke_test` and any targeted repo-root checks needed for the changed files
10. Manually verify the feature at the CLI/API surface when possible:

- use dry-run for planning features
- use apply-mode only when the env file and target round selection are ready
- for targeted-rerun archive validation, confirm `SUBMISSION_ARCHIVE_DIR` is set first; if the env file lacks it, export a writable override in the same shell command instead of editing or committing the env file
- if a live validation needs persisted submission `url` evidence and the submissions API does not expose it in this environment, use the approved read-only review DB snapshot path or other authoritative read-only evidence instead of guessing from incomplete API payloads
- verify the exact API-visible data that corresponds to the feature's `fulfills` assertions

11. End with a precise handoff. Be explicit about what was implemented, which assertions became testable, what commands ran, what manual checks were performed, whether this was a resume-validation case, and any tech debt or unresolved ambiguity.

## Example Handoff

```json
{
  "salientSummary": "Implemented round-plan reporting plus deterministic reuse-target selection for the importer. Added failing tests first, then made dry-run emit stable per-round records including matched challenge id and entity-level deltas.",
  "whatWasImplemented": "Added planning/reconciliation modules under data-migration/src plus CLI wiring so dry-run now reports one labeled record per selected round with legacy round id, matched v6 challenge id, decision, reason, resource/submission/final/provisional deltas, and traceability identifiers. Added deterministic no-stdin failure behavior for unresolved matches and covered rerun no-op classification.",
  "whatWasLeftUndone": "Live apply-mode verification against the dev environment is still blocked until .env.importer.local contains real DATABASE_URL / REVIEW_DB_URL / RESOURCES_API_URL / Auth0 values.",
  "verification": {
    "commandsRun": [
      {
        "command": "source \\\"$HOME/.config/nvm/nvm.sh\\\" && cd /home/jmgasper/Documents/Git/v6/challenge-api-v6/data-migration && nvm use 18.19.0 >/dev/null && pnpm test --maxWorkers=16 --runInBand plan-reporting.test.js",
        "exitCode": 0,
        "observation": "New planning tests passed after implementation; they failed before the code change because the CLI report omitted matched challenge ids and delta fields."
      },
      {
        "command": "source \\\"$HOME/.config/nvm/nvm.sh\\\" && cd /home/jmgasper/Documents/Git/v6/challenge-api-v6/data-migration && nvm use 18.19.0 >/dev/null && pnpm lint",
        "exitCode": 0,
        "observation": "ESLint passed for the importer package."
      }
    ],
    "interactiveChecks": [
      {
        "action": "Ran importer dry-run for round 10815 with missing env writes disabled and inspected the labeled per-round record.",
        "observed": "CLI reported decision=create with separate resource/submission/final/provisional deltas, traceability identifiers, and no stdin prompt."
      }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "data-migration/test/plan-reporting.test.js",
        "cases": [
          {
            "name": "emits one labeled record per selected round with matched challenge id and delta fields",
            "verifies": "VAL-PLAN-007, VAL-PLAN-008, VAL-PLAN-013"
          },
          {
            "name": "rerun dry-run classifies already imported work as unchanged",
            "verifies": "VAL-PLAN-014"
          }
        ]
      }
    ]
  },
  "discoveredIssues": [
    {
      "severity": "medium",
      "description": "Existing-v6 target matching still depends on the env-backed challenge dataset; no representative reuse-round fixture is checked into the repo yet.",
      "suggestedFix": "Add a small reusable reuse-round fixture bundle or seed helper so apply-mode integration tests can cover the reuse/backfill-only branch deterministically."
    }
  ]
}
```

## When to Return to Orchestrator

Return to the orchestrator when:

- the feature requires changing the backfill-only rule or any challenge-level overwrite behavior
- the feature needs a write path outside the allowed boundaries (`/mnt/Informix` mutation, direct Resource DB writes, etc.)
- the env-backed validation target is unavailable or credentials are missing for a feature that cannot be verified with fixtures alone
- a required legacy identity rule is still ambiguous (for example, how to derive a stable submission identity)
- existing-v6 data contradicts the mission invariants in a way that requires a product decision

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
5. Compare imported data to legacy data using read-only Python scripts.
6. Re-run apply or dry-run to prove idempotency.

### Fixture rounds

- `9892` — missing-historical create-path round
- `10089` — score-rich final-score ranking round
- `14272` — second round for multi-round filter checks
- one existing-v6 round chosen from dry-run output in the validation environment
- one round with unattachable finalists (for explicit skip/report validation), e.g. `10722`

## Validation Concurrency

### Surface: importer CLI + API verification

- **Max concurrent validators:** `5`
- **Rationale:** machine inspection during planning showed `32` CPUs, `46.83 GB` total RAM, and `32.25 GB` available RAM. Using the required 70% headroom rule gives about `22.58 GB` usable headroom. CLI + `curl` + `python` validators are lightweight and mostly share the same external services, so even five concurrent validators remain comfortably within CPU and memory budget.
- **Practical note:** concurrency should still be reduced if validators must run apply-mode writes against the same validation rounds; prefer partitioning by round or by assertion group to avoid data races.

## Readiness Notes

- Validation uses the existing dev environment referenced by `.env.importer.local`.
- `.env.importer.local` is populated, so live end-to-end apply-mode validation can proceed on the selected dev environment.
- Pre-existing repo-wide `standard-lint` noise in `challenge-api-v6` should not be mistaken for importer regressions; validators should focus on mission-owned surfaces.

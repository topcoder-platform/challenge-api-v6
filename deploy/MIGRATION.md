# OIDC deployment migration

This pipeline uses [deployment suite v2.0.5](https://github.com/topcoder-platform/tc-deploy-scripts/releases/tag/v2.0.5). CI fetches `refs/tags/v2.0.5` and verifies commit `bff574ab5c0b46773e25d2af1eff76675fba2ba5`. Builds and deployments run in separate jobs. The proposed deployment role, permissions boundary and STS session deny Parameter Store, Secrets Manager, KMS decryption and role chaining. ECS resolves runtime secret references through its execution role.

## Deployment manifests

`dev.json` contains the actual development service, repository and role identifiers verified through read-only AWS inspection on 2026-11-04. `prod.json` contains the production identifiers observed on 2026-11-03. The existing runtime roles are preserved. These files contain the minimal non-secret identifiers required by the deployer; no credentials or parameter values belong here.

This PR targets `develop`. That branch builds and deploys to dev using `dev.json` and the restricted `challenge-api-v6-dev-deploy` context. Production uses `prod.json`, the `master` branch and a manual approval gate. Other branches build only. Changing the PR base does not change these deployment filters.

## Private infrastructure provisioning

IAM policy/trust templates, provider definitions and detailed AWS/runtime-reference baselines are maintained separately from this public application repository. They are not fetched or installed by the deployment job. The reviewed definitions and dev provisioning instructions are maintained in [v6-services-iac](https://github.com/topcoder-platform/v6-services-iac/tree/main/services/challenge-api-v6). Provision them with an administrator identity before enabling deployment.

Dev setup completed on 2026-11-04:

- The account-level CircleCI OIDC provider and service-specific role with its matching permissions boundary are installed. Trust binds this project's repository and exact `develop` checkout/config refs. Secret reads, decryption and role chaining remain explicitly denied.
- ECR tags are immutable with no exclusions; existing enhanced continuous scanning is preserved.
- The reviewed container health check is deployed. Both running tasks and their load-balancer targets are healthy, using the same image and preserving runtime roles, secret references, capacity and circuit-breaker rollback.
- The empty `challenge-api-v6-dev-deploy` context is restricted to this project on `develop`, without SSH reruns or API-supplied config. Project-level environment variables are also empty. OIDC v3 issuance and AWS role assumption succeeded in the v2.0.2 dev retry and were confirmed through CloudTrail; fork-secret settings have not been verified.

Installation and verification records are maintained in the [private infrastructure repository](https://github.com/topcoder-platform/v6-services-iac/tree/main/services/challenge-api-v6/deploy). Production prerequisites remain separate.

## Dev acceptance

The dev infrastructure/context setup is complete. The v2.0.4 pipeline authenticated through OIDC, published an immutable image and passed the enhanced scan gate. ECS then rejected task registration because the untagged definition was submitted with `tags: []`. ECS was not updated and the existing service remains healthy.

This pipeline pins v2.0.5. [PR #45](https://github.com/topcoder-platform/tc-deploy-scripts/pull/45) omits empty registration tags while preserving existing tags and checking read-back equality. AWS failures now identify the service and operation without exposing request data or raw CLI output. No IAM changes are required for this fix.

The release retains [PR #44](https://github.com/topcoder-platform/tc-deploy-scripts/pull/44). The STS session permits the Inspector findings/coverage reads required by ECR enhanced scanning. The dev role and permissions boundary have already been updated through the private infrastructure repository. These two read-only actions are limited to the deployment region; AWS does not support repository-level restrictions for them, so they can read account-wide scan metadata in that region. Parameter Store, Secrets Manager, KMS decryption and role chaining remain explicitly denied. No Inspector configuration/write permissions are granted. Production provisioning remains separate.

The release also retains the earlier clean-image scan parsing, AWS CLI input and circuit-breaker compatibility fixes. Scan completion, 24-hour freshness and MEDIUM/HIGH/CRITICAL/UNDEFINED thresholds remain enforced. CI fetches the exact release tag and verifies the commit above. All 82 tests pass in the pinned executor, and merged-commit GitHub CI passes. IAM validation and live simulations confirm the regional reads and retained secret-access denies.

Merge into `develop` to retry deployment. OIDC authentication and scan gating are now verified. Check successful task registration and a healthy release, wrong-project/ref denial and an unhealthy-image rollback. Verify the deployment principal makes no SSM/Secrets Manager calls and that runtime roles/references remain unchanged. Do not bypass the scan gate. Remove old broker grants only after their other consumers migrate.

Only the dev prerequisites described above have been applied. No credentials or parameter values were read into the repository. Detailed installation, failure and verification evidence remains in the private infrastructure repository.

## Infrastructure source

IAM templates and detailed AWS baselines are maintained in the private [v6-services-iac service directory](https://github.com/topcoder-platform/v6-services-iac/tree/main/services/challenge-api-v6). Provision infrastructure separately with an administrator identity; application CI does not fetch that repository or install IAM. Required application manifests and health-check proposals remain here.

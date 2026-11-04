# OIDC deployment migration

This pipeline uses [deployment suite v2.0.0](https://github.com/topcoder-platform/tc-deploy-scripts/releases/tag/v2.0.0). CI fetches `refs/tags/v2.0.0` and verifies commit `dba6d24f8f53653a174d522ed177af66d1e28059`. Builds and deployments run in separate jobs. The proposed deployment role, permissions boundary and STS session deny Parameter Store, Secrets Manager, KMS decryption and role chaining. ECS resolves runtime secret references through its execution role.

## Deployment manifests

`dev.json` contains the actual development service, repository and role identifiers verified through read-only AWS inspection on 2026-11-04. `prod.json` contains the production identifiers observed on 2026-11-03. The existing runtime roles are preserved. These files contain the minimal non-secret identifiers required by the deployer; no credentials or parameter values belong here.

This PR targets `develop`. That branch builds and deploys to dev using `dev.json` and the restricted `challenge-api-v6-dev-deploy` context. Production uses `prod.json`, the `master` branch and a manual approval gate. Other branches build only. Changing the PR base does not change these deployment filters.

## Private infrastructure provisioning

IAM policy/trust templates, provider definitions and detailed AWS/runtime-reference baselines are maintained separately from this public application repository. They are not fetched or installed by the deployment job. The reviewed definitions and dev provisioning instructions are maintained in [v6-services-iac](https://github.com/topcoder-platform/v6-services-iac/tree/main/services/challenge-api-v6). Provision them with an administrator identity before enabling deployment.

Dev setup completed on 2026-11-04:

- The account-level CircleCI OIDC provider and service-specific role with its matching permissions boundary are installed. Trust binds this project's repository and exact `develop` checkout/config refs. Secret reads, decryption and role chaining remain explicitly denied.
- ECR tags are immutable with no exclusions; existing enhanced continuous scanning is preserved.
- The reviewed container health check is deployed. Both running tasks and their load-balancer targets are healthy, using the same image and preserving runtime roles, secret references, capacity and circuit-breaker rollback.
- The empty `challenge-api-v6-dev-deploy` context is restricted to this project on `develop`, without SSH reruns or API-supplied config. Project-level environment variables are also empty. Actual OIDC v3 issuance and AWS role assumption still need the first pipeline test; fork-secret settings have not been verified.

Installation and verification records are maintained in the [private infrastructure repository](https://github.com/topcoder-platform/v6-services-iac/tree/main/services/challenge-api-v6/deploy). Production prerequisites remain separate.

## Dev acceptance

The dev infrastructure/context setup is complete, but the first deployment remains blocked on the shared scanner fix and release pin described below. Validate wrong-project/ref denial, a successful dev release and an unhealthy-image rollback. Verify the deployment principal makes no SSM/Secrets Manager calls and that runtime roles/references remain unchanged. Remove old broker grants only after their other consumers migrate.

ECR omits the optional severity-count map for this clean image and returns an explicit empty findings list. Read-only Inspector inspection confirmed successful coverage and zero active findings. [tc-deploy-scripts PR #41](https://github.com/topcoder-platform/tc-deploy-scripts/pull/41) handles that response only when it identifies the exact requested image, explicitly contains no findings, and has no remaining page. It retains the completed-status, 24-hour freshness and MEDIUM/HIGH/CRITICAL/UNDEFINED gates, and needs no new IAM permissions.

**Before merging this PR:** merge the shared fix, publish a new patch release, and update this pipeline's fetched tag and verified commit. This PR still pins v2.0.0, which rejects the observed response. Do not retag v2.0.0 or bypass the scan gate. The existing image's scan is over 24 hours old and remains ineligible for release; the first candidate needs a fresh scan. The shared fix passes 69 tests locally and in the pinned executor, plus GitHub CI.

Validation: CircleCI config validation; v2 manifest validation; AWS IAM Access Analyzer and CloudFormation template validation of the private definitions; explicit-deny policy simulations; and a read-only task compatibility check with the proposed health check. The compatibility check preserves both runtime roles and every existing secret reference. The administrator-applied health-check revision has completed a healthy rollout with the existing image; the new CircleCI OIDC image-deployment pipeline and unhealthy-image rollback have not yet been exercised.

Only the dev prerequisites described above have been applied. No credentials or parameter values were read into the repository.

## Infrastructure source

IAM templates and detailed AWS baselines are maintained in the private [v6-services-iac service directory](https://github.com/topcoder-platform/v6-services-iac/tree/main/services/challenge-api-v6). Provision infrastructure separately with an administrator identity; application CI does not fetch that repository or install IAM. Required application manifests and health-check proposals remain here.

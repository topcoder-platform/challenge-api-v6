# OIDC deployment migration

This pipeline uses [deployment suite v2.0.0](https://github.com/topcoder-platform/tc-deploy-scripts/releases/tag/v2.0.0). CI fetches `refs/tags/v2.0.0` and verifies commit `dba6d24f8f53653a174d522ed177af66d1e28059`. Builds and deployments run in separate jobs. The proposed deployment role, permissions boundary and STS session deny Parameter Store, Secrets Manager, KMS decryption and role chaining. ECS resolves runtime secret references through its execution role.

## Deployment manifests

`dev.json` contains the actual development service, repository and role identifiers verified through read-only AWS inspection on 2026-11-04. `prod.json` contains the production identifiers observed on 2026-11-03. The existing runtime roles are preserved. These files contain the minimal non-secret identifiers required by the deployer; no credentials or parameter values belong here.

This PR targets `develop`. That branch builds and deploys to dev using `dev.json` and the restricted `challenge-api-v6-dev-deploy` context. Production uses `prod.json`, the `master` branch and a manual approval gate. Other branches build only. Changing the PR base does not change these deployment filters.

## Private infrastructure provisioning

IAM policy/trust templates, provider definitions and detailed AWS/runtime-reference baselines are maintained separately from this public application repository. They are not fetched or installed by the deployment job. Preserve their reviewed definitions in a private infrastructure repository or administrative artifact store and provision them with an administrator identity before enabling deployment.

For dev, the read-only inspection found:

- The expected service has two running tasks and circuit-breaker rollback enabled.
- The CircleCI OIDC provider and service-specific deployment role do not exist yet.
- ECR tags are mutable. Enhanced continuous image scanning is already enabled at the registry level.
- The task has no explicit container health check. Its load-balancer check uses `/v6/challenges/health` on container port 3000; `dev-healthcheck.json` proposes that same check.
- Existing runtime references can be preserved without fetching their values. CircleCI context existence and restrictions have not been verified through the AWS session.

Provision the account's CircleCI OIDC provider once, then the exact role named in `dev.json` with a matching permissions boundary. Bind trust to the recorded organization/project/repository and the exact `develop` checkout and configuration refs. Restrict PassRole to the existing runtime roles. The role and boundary must explicitly deny `ssm:*`, `secretsmanager:*`, `kms:Decrypt` and `sts:AssumeRole*`; a session-policy deny alone is insufficient.

Set the existing ECR repository to unconditional `IMMUTABLE` tags while preserving its enhanced scanning configuration. Add the proposed container health check through the infrastructure that owns the task definition, preserving its runtime references, roles, capacity and other settings. Keep execution-role secret access scoped to the application's required references.

Create/restrict `challenge-api-v6-dev-deploy` without Auth0/static AWS credentials. Confirm OIDC v3 issuance, restrict source/config refs and operators, and remove legacy credentials from project settings as well as contexts. Production prerequisites remain separate; do not apply the production manifest with the dev session.

## Dev acceptance

The manifest is now populated, but the first deployment remains blocked on the infrastructure/context prerequisites above. Validate wrong-project/ref denial, a successful dev release and an unhealthy-image rollback. Verify the deployment principal makes no SSM/Secrets Manager calls and that runtime roles/references remain unchanged. Remove old broker grants only after their other consumers migrate.

The current deployed image's ECR scan response was `ACTIVE` with a scan timestamp but no severity-count map. The v2.0.0 gate rejects that response. Verify the new candidate returns a supported, recent completed scan response, or review a shared-suite scanner fix before rollout; do not bypass the gate. The release rejects MEDIUM/HIGH/CRITICAL/UNDEFINED findings, missing/failed scans and mismatched image digests.

Validation: CircleCI config validation; v2 manifest validation; AWS IAM Access Analyzer and CloudFormation template validation of the private definitions; explicit-deny policy simulations; and a read-only task compatibility check with the proposed health check. The compatibility check preserves both runtime roles and every existing secret reference. These are not live deployment or rollback tests.

No AWS or CircleCI resources were modified while preparing this configuration. No credentials or parameter values were read into the repository.

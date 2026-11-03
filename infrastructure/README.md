# Azure Hub installation

Operators can provision a durable Hub, run setup before every release, and replace the image without replacing its database or artifacts. This reference chooses Terraform with AzureRM to follow the team's Terraform experience; it is an implementation choice, not an application dependency. The configuration is flat under [`azure/`](azure/) rather than split into one-resource modules.

This installs the current Hub, not hosted previews, review collaboration, user admission, or a sign-in provider. A public HTTPS endpoint does not authorize users or isolate prototype previews. Confirm product access requirements before exposing sensitive data.

## What is created

Each installation has its own resource group tagged with its application, installation name, owner, and Terraform ownership. It contains:

- A virtual network, delegated Container Apps and PostgreSQL subnets, and private PostgreSQL DNS.
- PostgreSQL Flexible Server, the `replica` database, enforced secure transport, and configurable point-in-time recovery retention.
- An Azure Storage account with private `artifacts` and `releases` containers, Blob versioning, and 14-day Blob and container soft deletion. Shared keys and anonymous access are disabled. The Blob endpoint is public-network reachable but requires Entra authorization; this is not a private-endpoint installation.
- One user-assigned workload identity with `Storage Blob Data Contributor` on **only** the artifacts container. An optional existing ACR receives an `AcrPull` assignment for that identity. No registry is created or owned.
- Log Analytics with 30-day retention, a Container Apps environment, a manual setup job, and, after successful setup, one combined Hub app.

The app has external HTTPS ingress and minimum and maximum one replica **per revision**. Multiple-revision mode permits explicit deactivation before releases. Azure's single-revision mode deliberately overlaps old and new processes while readiness is checked, so it is unsuitable for this maintenance-window strategy. Do not activate old revisions alongside the combined worker. This is not a high-availability or zero-downtime installation.

The runtime receives `RUNTIME_MODE=combined`, `HOST=0.0.0.0`, `PORT=3001`, `CLIENT_DIRECTORY=/app/dist/client`, `SHUTDOWN_TIMEOUT_MS=30000`, and `NODE_ENV=production`. Artifacts use `ARTIFACT_STORAGE_PROVIDER=azure`, the provisioned `AZURE_STORAGE_ACCOUNT`, `AZURE_STORAGE_CONTAINER=artifacts`, and the workload's `AZURE_CLIENT_ID`. `DATABASE_URL` is a Container Apps secret using `sslmode=verify-full`. Additional `runtime_secrets` are explicit, sensitive environment-name/value inputs; none are Terraform outputs.

The setup job uses the same digest, `RUNTIME_MODE=setup`, and command `node dist/server/scripts/setup/index.js`. It has one replica, no automatic retries, and a 30-minute timeout. Hub's readiness probe is `/api/ready`; startup and liveness use `/api/health`. Azure allows 60 seconds for termination, covering the 30-second application drain and up to five seconds of telemetry flushing with platform margin.

The reference uses the PostgreSQL administrator login for both setup and runtime so AzureRM alone can provision it without another database provider or remote SQL provisioner. Operators requiring separate migration/runtime roles must provision and test those grants before adapting this reference. Managed identity is used for Blob and ACR, not database authentication.

## Prepare access and protected state

Use the Terraform version constrained in [`versions.tf`](azure/versions.tf), a Node.js version supported by `scripts/package.json`, and a current Azure CLI with Container Apps job and revision commands. CI performs formatting, validation, mocked Terraform tests, and release-orchestration tests without cloud credentials. It does not deploy.

An authorized administrator must first create the **separate** Terraform backend: a dedicated state resource group, Storage account, and private container. Enable TLS, Entra authorization, Blob versioning and soft deletion; restrict network access to deployment runners and grant only the deployment identity `Storage Blob Data Contributor` on the state container. These bootstrap resources are not part of this installation's state or teardown. Never store this state in the app's artifacts account.

For automation, configure a dedicated deployment identity with a federated workload identity credential rather than a client secret. Bind its issuer to `https://token.actions.githubusercontent.com`, audience to `api://AzureADTokenExchange`, and subject to the exact protected repository/environment, such as `repo:YOUR_ORG/YOUR_REPO:environment:hub-production`. Protect that environment and deployment branch. A future release workflow needs `id-token: write` and must authenticate Azure CLI as the same identity; the infrastructure-check workflow intentionally has no such permission.

Set `ARM_CLIENT_ID`, `ARM_TENANT_ID`, `ARM_SUBSCRIPTION_ID`, and `ARM_USE_OIDC=true` in that authorized runner. Terraform's AzureRM backend supports GitHub's OIDC request environment; other runners must supply their supported OIDC token source. For local authorized operation, use Azure CLI sign-in and set `use_oidc=false` in your private backend configuration instead. Do not copy tokens into Terraform inputs.

The deployment identity needs resource creation/update rights for the installation, role-assignment rights for the container-scoped Blob grant and optional registry grant, and Blob data-plane rights on the installation's account for the lock blob. Resource `Contributor` alone does not grant Blob data access or role assignment. An administrator must authorize the initial resource-group creation and inherited Blob data access for bootstrap, then narrow ongoing deployment grants to that installation resource group, the existing registry, and the backend container. Precreated/imported infrastructure needs a separately reviewed initial plan rather than the empty-state bootstrap command. Do not grant the workload identity deployment or state access.

Register `Microsoft.App`, `Microsoft.OperationalInsights`, `Microsoft.Network`, `Microsoft.Storage`, `Microsoft.DBforPostgreSQL`, and `Microsoft.ManagedIdentity` beforehand. The provider does not register services across the subscription. Allow time for newly assigned RBAC roles to propagate before setup.

Copy [`backend.hcl.example`](azure/backend.hcl.example) to `infrastructure/azure/backend.hcl` and [`installation.tfvars.example`](azure/installation.tfvars.example) to `infrastructure/azure/installation.tfvars`. Both real files are ignored. Replace every placeholder, choose a globally unique name, and resolve an existing image to its real `registry/repository@sha256:...` digest. Use either a public image or an existing ACR; private non-ACR registry credentials and ACR's ABAC repository-permissions mode are not covered by this reference.

Supply `postgres_admin_password` from a secret manager as `TF_VAR_postgres_admin_password`, or through the ignored variables file with mode `0600`. Supply optional `TF_VAR_runtime_secrets` as a JSON object of uppercase environment names to secret values. Never enable shell tracing while injecting secrets. Terraform's sensitive marking redacts normal CLI output but **does not encrypt state or saved plans**. Protect backend access, runner logs, environment variables, and local `.terraform/`; never publish a JSON plan or upload it as a CI artifact.

## Bootstrap and release

Run these commands from the repository root in an authorized environment. They change Azure resources; do not run them merely to validate this repository.

```sh
export HUB_SUBSCRIPTION='your-subscription-id'
export HUB_IMAGE='your-registry/replica-hub@sha256:your-real-64-character-digest'
node infrastructure/azure/deploy-hub/index.ts bootstrap \
  --subscription "$HUB_SUBSCRIPTION" \
  --backend infrastructure/azure/backend.hcl \
  --variables infrastructure/azure/installation.tfvars \
  --image "$HUB_IMAGE"
```

Bootstrap creates infrastructure and the manual setup job with `deploy_hub=false`. No combined app exists yet. Review the configuration and a read-only Terraform plan before authorizing this command: the script prints its plans and applies them without an interactive prompt after checking for deletes/replacements. Bootstrap refuses any nonempty state so it cannot race a release on an existing installation. If initial provisioning failed partway, inspect the partial state and recover from a separately reviewed plan with `deploy_hub=false`; never use this recovery path after an app has been created.

Use the same release command for the first installation, subsequent image releases, and infrastructure or secret changes:

```sh
node infrastructure/azure/deploy-hub/index.ts release \
  --subscription "$HUB_SUBSCRIPTION" \
  --backend infrastructure/azure/backend.hcl \
  --variables infrastructure/azure/installation.tfvars \
  --image "$HUB_IMAGE" \
  --accept-maintenance
```

The operator must approve the maintenance window and inspect intended configuration changes before invoking the command. A read-only plan can be reviewed with `terraform -chdir=infrastructure/azure plan -var-file=installation.tfvars -var="image=$HUB_IMAGE" -var=deploy_hub=true` after initializing the configured backend. Do not apply that preflight plan: setup must run first. The script then:

1. Checks the explicit subscription, Terraform state's installation, and resource group ownership.
2. Acquires an infinite lease on `releases/deployment.lock`. A competing release fails before stopping Hub. This serializes the whole release, not just individual Terraform operations; setup's database advisory lock remains a separate defense.
3. Checks that no setup execution is running, deactivates every active revision, and waits for **all** old revision replicas to disappear before setup. Users cannot use Hub during this window.
4. Uses a deliberate targeted Terraform plan/apply for the setup job and its infrastructure dependencies. It cannot update the app at this point.
5. Starts that job, checks that exact execution until it succeeds, and stops on failure or timeout.
6. Only after success, plans/applies the complete configuration with `deploy_hub=true` and the same image digest. It activates the latest revision, waits for Azure's ready-revision signal and an HTTPS `/api/ready` response, then releases the lease.

Terraform owns the image in both resources. There is deliberately **no** `ignore_changes` or out-of-band `az containerapp update --image`: a later infrastructure apply cannot silently use a stale image. Provisioning and rollout are separated by the two phases above. Never run a full Terraform apply directly on an installed Hub, start a setup job manually, or change revisions in the portal outside this serialized procedure. Terraform state locking alone does not protect setup-to-rollout ordering. The app's `prevent_destroy` guard rejects accidental `deploy_hub=false` on later full plans.

Plans reject resource deletion and replacement during normal releases. A database major upgrade, region move, rename, or replacement needs a reviewed migration/recovery plan, not an override of that guard. The release script deletes its sensitive saved plan on exit. It leaves Hub stopped and retains the infinite lease after any release failure; it never reactivates an older process automatically against a possibly migrated schema.

### Recover a failed release

Inspect the named setup execution and Container Apps/Log Analytics logs using authorized Azure access. Check that the release process has exited, every setup execution is terminal, and no old revision still has replicas. After a successful but partially deployed setup, decide whether to retry the same digest or use a compatible recovery image. Prisma migrations, queue migrations, and schedule registration are not a single atomic transaction.

Only after those checks may an operator break the retained lease:

```sh
az storage blob lease break --account-name YOUR_ACCOUNT \
  --container-name releases --blob-name deployment.lock \
  --auth-mode login --lease-break-period 0 --subscription "$HUB_SUBSCRIPTION"
```

Retry the release command. Do not break an active release's lease. A lease is an operational lock, not protection from administrators bypassing the procedure. If destruction already deleted the lock blob, complete the reviewed teardown rather than starting another release.

Rollback is another release with a previously published compatible digest. It reruns setup, so confirm that the old image tolerates the current schema and schedules. There is no automatic database or queue downgrade. Retry and shutdown do not guarantee exactly-once jobs; business effects must tolerate at-least-once delivery. Replica disappearance is the available control-plane gate, not evidence that Azure has been proven free of all revision overlap; verify it in the target tenant before relying on worker exclusivity.

## Hostname and TLS

The Azure-generated app hostname already uses HTTPS. For a custom domain, first bootstrap and release using that hostname. Create the required DNS ownership TXT and CNAME/A records using the app's verification identifier and address reported by Azure. Upload or provision a certificate in **this** Container Apps environment through your authorized certificate process, then provide both `custom_hostname` and its existing `certificate_id` and run another release. Certificates, DNS zones, certificate renewals, and private keys are not created or owned by this Terraform configuration.

Verify the custom hostname, HTTPS certificate, redirects/cookies/callback origin configuration, and readiness separately. The release's automated HTTPS check uses the Azure-generated hostname and does not prove custom-domain TLS or authenticated product flows.

## Backups, restore, and migration

PostgreSQL retains point-in-time backups for `backup_retention_days` (default 14). Blob/container soft deletion retains deleted objects for 14 days; versioning preserves earlier content, but versions incur storage charges and are not an independent backup. These defaults provide neither regional disaster recovery nor high availability. Managed PostgreSQL, the app's minimum replica, private networking, logs, backups, and Blob versions have ongoing costs even when traffic is low.

Agree on acceptable data loss and recovery time with the installation owner. Schedule independent database exports and artifact copies to a separately authorized backup destination with its own retention. Run database exports from an authorized private-network host or job; PostgreSQL has no public firewall exception. Encrypt exports and never place credentials in commands, logs, or committed files.

For recovery, stop releases and Hub, record the database recovery point and matching artifact manifest, and restore PostgreSQL to a **new** server using Azure point-in-time recovery. Restore Blob versions or independent copies to a separate private container/account. Verify database records, queue state, and artifact references together. A database restore alone cannot restore matching artifact state.

Reconcile the restored resources with a reviewed Terraform configuration and import/state-migration plan before deployment; a restored server has different identifiers and this normal release script intentionally rejects replacements. Do not overwrite or delete the original resources until the restored installation has passed setup, integrity checks, HTTPS/readiness, representative authenticated operations, and a measured recovery exercise. Document the observed recovery time and data loss.

To move an existing installation, pause writes and workers, export PostgreSQL, copy artifacts with an object manifest, import both into the new installation, and verify counts/checksums and a representative operation before switching traffic. Keep source backups and a rollback window. No automatic migration between local and Azure installations is performed here.

## Guarded destruction

Destruction removes database and artifact state. Take verified independent backups first. The default app lifecycle guard intentionally prevents a complete destroy: remove **only** the app's `prevent_destroy` block in a reviewed local change after the owner authorizes permanent deletion. Restore the guard afterward. For a bootstrap that never created the app, no guard edit is needed.

```sh
node infrastructure/azure/deploy-hub/index.ts destroy \
  --subscription "$HUB_SUBSCRIPTION" \
  --backend infrastructure/azure/backend.hcl \
  --variables infrastructure/azure/installation.tfvars \
  --image "$HUB_IMAGE" \
  --accept-maintenance --confirm YOUR_EXACT_INSTALLATION_NAME
```

The script requires matching ownership tags and the exact installation name, acquires the release lock, stops Hub, checks setup executions, and applies a Terraform destroy plan. It deletes only Terraform-tracked resources; it does not issue a broad resource-group deletion command. AzureRM refuses to delete a resource group containing unmanaged resources. Review a read-only `terraform plan -destroy` with the same variables and `deploy_hub=true` before authorizing the command; the script itself does not pause for review. An existing registry, state backend, DNS, and externally supplied certificate are never independently targeted by this configuration. Azure may remove its own environment infrastructure group when the environment is deleted.

Storage-account deletion does not preserve a usable Blob backup just because object soft deletion was enabled. Provider-retained PostgreSQL backups, soft-deleted logs, or other Azure retention may outlive resource deletion; verify the service-specific retention and billing in your tenant. The separate Terraform state backend and its historical sensitive versions remain until an administrator applies their own retention/deletion policy.

## Credential-free checks and evidence limits

From `infrastructure/azure/`:

```sh
terraform init -backend=false -input=false -lockfile=readonly
terraform fmt -check -recursive
terraform validate
terraform test
node --test deploy-hub/index.test.ts
```

Terraform tests use AzureRM mocks, not an Azure subscription. Orchestration tests replace command execution and HTTPS requests, proving ordering and failure gates rather than Azure behavior. Before production, an authorized tenant exercise must verify provisioning, private PostgreSQL connectivity and TLS, identity-based Blob/ACR access after RBAC propagation, failed setup blocking rollout, maintenance shutdown and revision behavior, HTTPS/readiness, persistence across replacement, custom TLS when configured, backup restoration, and owned-resource teardown. No real-cloud result is implied by these local checks.

The release command and its tests are TypeScript running directly in Node.js. Terraform's own tests use `.tftest.hcl`; neither requires Python. From the repository root, `npm run typecheck --prefix scripts` checks the TypeScript operational scripts as well.

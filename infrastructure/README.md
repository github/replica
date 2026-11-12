# Azure Hub installation

Operators can provision a durable Hub, run setup before every release, and replace the image without replacing its database or artifacts. This reference chooses Terraform with AzureRM to follow the team's Terraform experience; it is an implementation choice, not an application dependency. The main installation is flat under [`azure/`](azure/) rather than split into one-resource modules.

Definitions are grouped by responsibility: [`networking.tf`](azure/networking.tf), [`database.tf`](azure/database.tf), [`storage.tf`](azure/storage.tf), [`roles.tf`](azure/roles.tf), [`environment.tf`](azure/environment.tf), [`application.tf`](azure/application.tf), and [`setup.tf`](azure/setup.tf). Shared tags and the resource group remain in [`main.tf`](azure/main.tf). These files form one Terraform module; moving declarations between them does not change resource addresses or require state migration.

The current Hub supports GitHub sign-in and reusable administrator enrollment when configured. This reference does not configure those optional authentication settings by default, and hosted previews and review collaboration are not built yet. Supply the protected settings from [Hub deployment](../hub/docs/deployment.md#image-and-runtime), including the exact protected proxy-chain length, before enabling authentication. A public HTTPS endpoint does not authorize users or isolate prototype previews.

## What is created

Each installation has its own resource group tagged with its application, installation name, owner, and Terraform ownership. It contains:

- A virtual network, delegated Container Apps and PostgreSQL subnets, and private PostgreSQL DNS.
- PostgreSQL Flexible Server, the `replica` database, enforced secure transport, and configurable point-in-time recovery retention.
- An Azure Storage account with private `artifacts` and `releases` containers, Blob versioning, and 14-day Blob and container soft deletion. Shared keys and anonymous access are disabled. The Blob endpoint is public-network reachable but requires Entra authorization; this is not a private-endpoint installation.
- Separate Hub and setup user-assigned identities. Only Hub receives `Storage Blob Data Contributor` on the artifacts container. Each identity can read only its referenced Key Vault secrets and, when configured, pull from an existing ACR. No vault or registry is created or owned.
- Log Analytics with 30-day retention, a Container Apps environment, a manual setup job, and, after successful setup, one combined Hub app.

Two optional modules have separate Terraform states and lifecycles. [`azure/foundation/`](azure/foundation/main.tf) creates an installation-owned ACR and RBAC-enabled Key Vault in a separate resource group, with `AcrPush` and `Key Vault Secrets Officer` grants for the deployment identity. The vault has 90-day soft deletion and purge protection. Pass its registry and vault outputs to the main installation; the main module still accepts existing resources and never owns their teardown.

[`azure/provision/`](azure/provision/main.tf) creates a temporary private-network database-role provisioning job and identity in the installation's Container Apps environment. It accepts the same immutable image and exactly three versioned Key Vault references: `DATABASE_URL` for the administrator, `HUB_MIGRATION_PASSWORD`, and `HUB_RUNTIME_PASSWORD`. Each secret URL must belong to the supplied `vault_id`. Omit `registry_id` for a public image; an existing ACR requires its resource ID and grants only the provisioning identity pull access. The job has one replica, no automatic retries, and a ten-minute timeout. An authorized operator must run it once against a fresh database, verify that exact execution succeeded, and remove the temporary job, identity, and grants before release. Do not rerun it against an installed database or grant its administrator secret to Hub or setup. The existing private-network operator script remains an alternative.

Initialize each optional module against its own protected backend state key, review its declared inputs and Terraform plan, and authorize its apply separately. Never share a state key with the main installation. Neither module starts Hub or replaces the serialized release command.

The app has external HTTPS ingress and minimum and maximum one replica **per revision**. Multiple-revision mode permits explicit deactivation before releases. Azure's single-revision mode deliberately overlaps old and new processes while readiness is checked, so it is unsuitable for this maintenance-window strategy. Do not activate old revisions alongside the combined worker. This is not a high-availability or zero-downtime installation.

The runtime receives `RUNTIME_MODE=combined`, `HOST=0.0.0.0`, `PORT=3001`, `CLIENT_DIRECTORY=/app/dist/client`, `SHUTDOWN_TIMEOUT_MS=30000`, and `NODE_ENV=production`. Artifacts use `ARTIFACT_STORAGE_PROVIDER=azure`, the provisioned `AZURE_STORAGE_ACCOUNT`, `AZURE_STORAGE_CONTAINER=artifacts`, and Hub's `AZURE_CLIENT_ID`. `DATABASE_URL` references a Key Vault secret for the `replica_runtime` database role with `sslmode=verify-full`. Optional `runtime_secret_references` map environment names to vault resource IDs and HTTPS secret URLs. Container Apps resolves these references using Hub's identity; Hub does not implement a separate secret-resolution framework.

Terraform ignores only Azure-assigned PostgreSQL availability-zone and Container Apps infrastructure-resource-group values. It still checks other drift and owns both images. The installation output exposes authoritative app, resource-group, and storage-account IDs; before the first release, the app ID is `null`.

The setup job uses the same digest and command `node dist/server/scripts/setup/index.js`. Its only environment settings are `NODE_ENV=production`, `RUNTIME_MODE=setup`, `DATABASE_RUNTIME_ROLE=replica_runtime`, and its own Key Vault-backed `DATABASE_URL` for `replica_migration`. It receives no artifact configuration or additional runtime secrets. It has one replica, no automatic retries, and a 30-minute timeout. Hub's readiness probe is `/api/ready`; startup and liveness use `/api/health`. Azure allows 60 seconds for termination, covering the 30-second application drain and up to five seconds of telemetry flushing with platform margin.

Neither workload receives the PostgreSQL administrator credential. A separate, one-time operator script provisions the migration and runtime roles over the private database network. Setup owns schema changes and refreshes the runtime's data permissions after migrations. See [database access](../hub/docs/database.md#deployment-database-roles). Managed identity is used for Blob, Key Vault, and ACR, not database authentication.

## Prepare access and protected state

Use the Terraform version constrained in [`versions.tf`](azure/versions.tf), a Node.js version supported by `scripts/package.json`, and a current Azure CLI with Container Apps job and revision commands. CI performs formatting, validation, mocked Terraform tests, and release-orchestration tests without cloud credentials. It does not deploy.

An authorized administrator must first create the **separate** Terraform backend: a dedicated state resource group, Storage account, and private container. Enable TLS, Entra authorization, Blob versioning and soft deletion; disable shared-key authorization and anonymous Blob access, and grant the deployment identity `Storage Blob Data Contributor` on the state container. Apply any network restrictions required by deployment policy and ensure the runner can reach the account. These bootstrap resources are not part of this installation's state or teardown. Never store this state in the app's artifacts account.

For automation, configure a dedicated deployment identity with a federated workload identity credential rather than a client secret. Bind its issuer to `https://token.actions.githubusercontent.com`, audience to `api://AzureADTokenExchange`, and subject to the exact protected repository/environment, such as `repo:YOUR_ORG/YOUR_REPO:environment:hub-production`. Protect that environment and deployment branch. A future release workflow needs `id-token: write` and must authenticate Azure CLI as the same identity; the infrastructure-check workflow intentionally has no such permission.

Set `ARM_CLIENT_ID`, `ARM_TENANT_ID`, `ARM_SUBSCRIPTION_ID`, and `ARM_USE_OIDC=true` in that authorized runner. Terraform's AzureRM backend supports GitHub's OIDC request environment; other runners must supply their supported OIDC token source. For local authorized operation, use Azure CLI sign-in and set `use_oidc=false` in your private backend configuration instead. Do not copy tokens into Terraform inputs.

The deployment identity needs resource creation/update rights for the installation, role-assignment rights for the artifact container, referenced Key Vault secrets and optional registry, and Blob data-plane rights on the installation's account for the lock blob. Resource `Contributor` alone does not grant data access or role assignment. An administrator must authorize initial resource-group creation and inherited Blob data access for bootstrap, then narrow ongoing deployment grants to the installation resource group, referenced secrets, existing registry, and backend container. Precreated/imported infrastructure needs a separately reviewed initial plan rather than the empty-state bootstrap command. Do not grant either workload identity deployment or state access.

The main module's optional `grant_deployment_storage_access=true` grants the authenticated Terraform deployment identity `Storage Blob Data Contributor` on the installation account. It defaults to `false`; use it only when this account-level grant matches the deployment policy. It does not grant access to the separate state backend.

Register `Microsoft.App`, `Microsoft.OperationalInsights`, `Microsoft.Network`, `Microsoft.Storage`, `Microsoft.DBforPostgreSQL`, and `Microsoft.ManagedIdentity` beforehand. Before applying the optional foundation module, also register `Microsoft.ContainerRegistry` and `Microsoft.KeyVault`. The providers do not register services across the subscription. Allow time for newly assigned RBAC roles to propagate before setup.

Copy [`backend.hcl.example`](azure/backend.hcl.example) to `infrastructure/azure/backend.hcl` and [`installation.tfvars.example`](azure/installation.tfvars.example) to `infrastructure/azure/installation.tfvars`. Both real files are ignored. Replace every placeholder, choose a globally unique name, and resolve an existing image to its real `registry/repository@sha256:...` digest. Use either a public image or an existing ACR; private non-ACR registry credentials and ACR's ABAC repository-permissions mode are not covered by this reference.

Prepare an existing RBAC-enabled Key Vault reachable by the Container Apps environment. Supply `runtime_database_secret` and `setup_database_secret`, each with the vault's resource ID and a distinct HTTPS secret URL. Before bootstrap, store separate database URLs for `replica_runtime` and `replica_migration` with independently generated passwords, the planned private PostgreSQL hostname, database `replica`, and `sslmode=verify-full`. Percent-encode URL credentials. The identities receive secret-scoped `Key Vault Secrets User` grants, so sharing a vault does not give setup access to runtime secrets. Additional runtime references must not point at the migration credential. The vault, secret values, rotation and retention remain operator-owned; Terraform never reads those values. Prefer versioned URLs for deliberate rotation through a serialized release.

Supply `postgres_admin_password` from a secret manager as `TF_VAR_postgres_admin_password`, or through the ignored variables file with mode `0600`. This provisioning password still enters Terraform state; replacing application secret values with references does not remove it or erase historical secret values in older state versions. Never enable shell tracing while injecting secrets. Terraform's sensitive marking redacts normal CLI output but **does not encrypt state or saved plans**. Protect backend access, runner logs, environment variables, and local `.terraform/`; never publish a JSON plan or upload it as a CI artifact.

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

Bootstrap creates infrastructure and the manual setup job with `deploy_hub=false`. No combined app exists yet. Review the configuration and a read-only Terraform plan before authorizing this command: the script applies saved plans without an interactive prompt after checking for deletes/replacements. Command output is kept private because tool diagnostics can contain credentials. Bootstrap refuses any nonempty state so it cannot race a release on an existing installation. If initial provisioning failed partway, inspect the partial state and recover from a separately reviewed plan with `deploy_hub=false`; never use this recovery path after an app has been created.

Before the first release, use an authorized private-network host with Hub's dependencies installed to run `node server/scripts/provision-database-access/index.ts` from `hub/`. Inject the administrator `DATABASE_URL`, `HUB_MIGRATION_PASSWORD`, and `HUB_RUNTIME_PASSWORD` directly from the secret manager without shell tracing or command-line values. Use the same two passwords stored in the workload URL secrets. This first-installation script creates the roles and schemas transactionally and rejects existing roles, public tables, or a pre-existing BullMQ schema; it is not an upgrade or password-rotation command. Remove these environment variables afterward. Do not inject administrator credentials into the setup job. Existing installations require a reviewed ownership/credential migration while Hub is stopped, not rerunning this fresh-database script.

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
2. Acquires an infinite lease on `releases/deployment.lock`. A competing release fails before stopping Hub. The orchestrator owns serialization of the whole release, not just individual Terraform operations. Setup's advisory lock rejects concurrent setup while its database connection remains healthy; it cannot protect the child-termination interval after that connection is lost.
3. Checks that no setup execution is running, deactivates every active revision, and waits for **all** old revision replicas to disappear before setup. Users cannot use Hub during this window.
4. Uses a deliberate targeted Terraform plan/apply for the setup job and its infrastructure dependencies. It cannot update the app at this point.
5. Starts that job, checks that exact execution until it succeeds, and stops on failure or timeout.
6. Only after success, plans/applies the complete configuration with `deploy_hub=true` and the same image digest. It activates the latest revision, waits for Azure's ready-revision signal and an HTTPS `/api/ready` response, then releases the lease.

Terraform owns the image in both resources. There is deliberately **no** `ignore_changes` or out-of-band `az containerapp update --image`: a later infrastructure apply cannot silently use a stale image. Provisioning and rollout are separated by the two phases above. Never run a full Terraform apply directly on an installed Hub, start a setup job manually, or change revisions in the portal outside this serialized procedure. Terraform state locking alone does not protect setup-to-rollout ordering. The app's `prevent_destroy` guard rejects accidental `deploy_hub=false` on later full plans.

Plans reject resource deletion and replacement during normal releases. A database major upgrade, region move, rename, or replacement needs a reviewed migration/recovery plan, not an override of that guard. The release script stores sensitive plans under `TF_DATA_DIR` when nonempty, otherwise under the module's `.terraform/`, and deletes them on exit. Relative `TF_DATA_DIR` paths resolve against `infrastructure/azure/`, matching Terraform's `-chdir` behavior; protect that directory if it is outside the module. Failures identify a fixed command label and available exit code without printing arguments or tool output. It leaves Hub stopped and retains the infinite lease after any release failure; it never reactivates an older process automatically against a possibly migrated schema.

### Recover a failed release

Inspect the named setup execution and Container Apps/Log Analytics logs using authorized Azure access. Check that the release process has exited, every setup execution is terminal, and no old revision still has replicas. After a successful but partially deployed setup, decide whether to retry the same digest or use a compatible recovery image. Prisma migrations, queue migrations, and schedule registration are not a single atomic transaction.

Confirm that the prior migration database sessions have also stopped before retrying, including after a lost setup-lock connection. Only after those checks may an operator break the retained lease:

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

From `infrastructure/azure/`, check the main installation:

```sh
terraform init -backend=false -input=false -lockfile=readonly
terraform fmt -check -recursive
terraform validate
terraform test
node --test deploy-hub/index.test.ts stop-hub/index.test.ts ../installer/command/describe/index.test.ts
```

Run the same Terraform initialization, formatting, validation, and test commands from `foundation/` and `provision/` to check the optional modules. CI checks each module using both supported Terraform versions in [the workflow matrix](../.github/workflows/hub-infrastructure.yml).

Terraform tests use AzureRM mocks, not an Azure subscription. Orchestration tests replace command execution and HTTPS requests, proving ordering and failure gates rather than Azure behavior. Readiness includes a bounded, non-writing container-properties request through Hub's managed identity; it detects unavailable storage but does not prove write or delete authorization. Worker readiness remains initialization-only. Before production, an authorized tenant exercise must verify provisioning, private PostgreSQL connectivity and TLS, separate database roles, Key Vault resolution, identity-based Blob/ACR access after RBAC propagation, failed setup blocking rollout, maintenance shutdown and revision behavior, HTTPS/readiness, persistence across replacement, custom TLS when configured, backup restoration, and owned-resource teardown. No real-cloud result is implied by these local checks.

The release command and its tests are TypeScript running directly in Node.js. Terraform's own tests use `.tftest.hcl`; neither requires Python. From the repository root, `npm run typecheck --prefix scripts` checks the TypeScript operational scripts as well.

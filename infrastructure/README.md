# Azure Hub installation

## Guided installation

New setups start by asking which cloud to use. Azure is available; AWS is shown as unavailable with "Coming soon". The themed Ink interface lives in `installer/`, above the cloud-specific directories. Azure configuration and orchestration live in `azure/install/`; reusable Terraform execution lives in `terraform/`. Terraform resources are grouped into separate Azure root modules: `azure/foundation/` owns the registry and vault, `azure/` owns the running installation, and `azure/provision/` owns temporary database provisioning. None of these Terraform modules depends on Ink or React.

Every full-screen launch welcomes you with ASCII art above the first question, including the resume menu and saved-installation setup. The art disappears after your first answer and is omitted when the terminal is smaller than 60 columns by 24 rows. A compact stage map shows progress, while an elapsed counter stays in the footer. The counter measures this run, including time waiting for you; it restarts after the process restarts. Errors and warnings are labeled and colored separately from muted operational activity.

The wizard uses a separate terminal screen and restores your shell on completion, cancellation, and catchable errors. Use Page Up and Page Down to scroll long notices or approval details. Narrow screens show the current stage and position instead of the full map. Use `npm run setup:server -- --no-fullscreen` for inline mode. Limited terminals and `INK_SCREEN_READER=true` also use inline mode, without welcome art or an animated timer.

From the repository root, install the wizard's dependencies and start it:

```sh
npm ci --prefix infrastructure --ignore-scripts --engine-strict
npm run setup:server
```

If your organization requires an npm proxy, use it for this initial dependency installation before the wizard can load. For example:

```sh
npm ci --prefix infrastructure --ignore-scripts --engine-strict \
  --registry=https://packagefeedproxy.microsoft.io/npm/ --replace-registry-host=never
npm run setup:server
```

The wizard separately asks whether the container build needs a proxy. Host npm settings and flags used to install the wizard are not inherited by Docker. Without a selected proxy, the container needs public npm access. The wizard passes the selected HTTPS registry into the Docker build and resolves the pinned dependency versions through that registry without changing your global npm configuration or the source lockfile. Proxy credentials in URLs and authenticated proxy setup are not supported. Do not pass tokens through build arguments.

Use a supported Node version, stable Terraform `>= 1.13.0, < 2.0.0`, Azure CLI with Container Apps job/revision support, and a running Docker engine with Buildx. CI checks Terraform 1.13.4 and 1.17.1; the AzureRM provider remains separately pinned and locked. The wizard explains missing prerequisites and waits while you complete them. Sign in with `az login` in a separate terminal; the wizard does not automate authentication. This first version supports local operator execution on macOS and Linux, not a federated CI deployment identity.

The first run asks for an Azure tenant, then lists only that tenant's enabled subscriptions and regions advertised for all required services. Type a name or ID to filter each list, use Up/Down to scroll, and press Enter to select. Each list shows matching and total counts and how many options are visible at a time. Saved tenants, subscriptions, and regions appear first.

Tenant choices come from subscriptions in your current Azure CLI sign-in, using the tenant name or domain when Azure provides it. Tenants without an enabled subscription and tenant-only sign-in accounts are not deployment targets. If a tenant is missing, sign in with `az login --tenant TENANT_ID` in a separate terminal, then restart the wizard. The installer does not automate sign-in or install the experimental Azure CLI account extension.

The wizard then asks for the installation name, owning team or person, and dedicated app resource group. The owning team or person is a label saved in configuration and Azure resource tags; it does not assign billing or permissions or send notifications. Each text answer is validated before moving to the next question. The wizard explains invalid values and lets you correct that field without repeating earlier answers. Your subscription must still have sufficient quota and permission to deploy in the chosen region. The wizard does not bypass denied permissions or subscription policy.

Before provisioning, it shows the target and asks permission for billable resources, role assignments, image publication, and a maintenance-window release. Terraform changes receive separate confirmation, including the removal of temporary provisioning access. The signed-in identity needs resource creation and role-assignment rights, permission to register the required providers, and access through applicable Azure network policies. An administrator may need to grant these rights. Resource Contributor alone is insufficient.

The guided flow creates a tagged state resource group/account first, with shared-key authorization and anonymous blob access disabled, TLS, identity-based data access, versioning, and soft deletion. Its public network endpoint accepts requests from any network, but reading or changing state still requires Azure authentication and Blob data permissions. The wizard does not require an IP address, CIDR, or external IP lookup. These bootstrap resources remain outside application Terraform state and are never deleted by the normal application destroy command. Do not reuse this backend for unrelated installations.

If an earlier installer created an IP-restricted state account, the wizard verifies its ownership and authentication settings, then asks before switching to authenticated access without the network restriction. It verifies the resulting settings before using state storage. It will not override disabled public access, a network perimeter, or an account with different ownership or unsafe authentication settings. If your organization requires private networking, use an authorized deployment path rather than bypassing that policy.

It then uses separate protected Terraform state files for the foundation, application, and temporary provisioning modules. Foundation resources include an ACR and an RBAC-enabled, purge-protected Key Vault. Passwords are generated independently and written to Key Vault using private temporary files, never command-line values. Existing credentials are reused, not silently rotated. The PostgreSQL administrator password still enters protected application Terraform state.

The wizard builds and pushes a Linux AMD64 image and deploys its immutable digest. On first installation, Hub remains absent while a separate private-network job initializes the database roles. This job has its own temporary managed identity and secret-scoped administrator/password access; neither Hub nor normal setup receives administrator access. After success, the wizard records completion in Key Vault and destroys the temporary job, identity, and grants before invoking the existing serialized release procedure.

The final release stops old revisions, runs migrations and schedule setup, starts Hub, and checks HTTPS readiness. Readiness is not authorization: this runtime does not yet implement sign-in, artifact import, preview hosting, or reviews. Configure access appropriately before exposing sensitive data.

### Saved configuration and repeat runs

By default, non-secret choices are saved in ignored `infrastructure/.local/installation.json`, with private generated inputs and Terraform working directories under `.local/INSTALLATION_NAME/`. Keep these files private and preserve the configuration for later releases. Start from [`installation.example.json`](installation.example.json) if you prefer to fill out the JSON yourself. Real configuration files belong under the ignored `.local/` directory, not beside the tracked example. The root shortcut runs the wizard from `infrastructure/`, so relative `--config` paths are resolved from that directory.

```sh
# Collect and save configuration without creating cloud resources.
npm run setup:server -- --configure-only

# Reopen a saved configuration interactively.
npm run setup:server -- --config .local/installation.json

# Explicit approval for automation includes publication, Terraform changes,
# temporary provisioning cleanup, and a maintenance window.
npm run setup:server -- \
  --config .local/installation.json \
  --non-interactive --approve-deployment
```

Non-interactive execution requires complete configuration and fails with instructions when a prerequisite requires human action. It does not answer missing configuration questions or escalate access. Interactive runs refuse to overwrite a saved installation with a different target or owner; use a new configuration file for another installation. Normal updates use the existing release orchestrator; the wizard never directly applies the full application configuration to an installed Hub.

Interactive runs also save a private companion draft at `<config path>.draft.json`, such as `.local/installation.json.draft.json`. Each accepted answer and phase transition is saved before continuing. On restart, the wizard shows the draft's target and last-save time and offers Resume setup, Start over, or Exit. Resume rechecks Azure access and available choices, then returns to the first unresolved question. Changed parent choices invalidate dependent answers without discarding independent settings.

Drafts contain only validated non-secret choices, not raw keystrokes, search queries, command output, credentials, or consent for cloud changes. A draft does not replace complete deployment configuration or prove that a resource operation succeeded. Start over requires confirmation and only resets the local draft; it does not delete resources or clear cloud leases. Successful configuration-only or deployment completion removes the draft and keeps the reusable configuration. Non-interactive execution never consumes a draft.

The local `<config path>.draft.json.lock` allows one interactive writer per configuration. An exited process on the same host can be recovered automatically. An active writer, an unknown owner, or a malformed writer record blocks reuse with instructions. If a crash leaves a `.lock.recovery` record, verify the recorded owning process has exited before reviewing and removing that exact local recovery file. These local files are not the Azure installation or release leases described below.

Older version-1 configuration files may contain `azure.stateAllowedIp`. That obsolete setting is accepted but ignored, and is omitted when the configuration is saved again.

The wizard only reuses resources owned by this installation and matching its Terraform state. It does not automatically adopt existing shared registries, vaults, or unrelated resource groups. Use the manual reference below when connecting an externally managed registry, vault, backend, or an existing installation not created by this wizard.

### Correcting answers and retrying lookups

Installation name, ownership label, resource group, and npm registry inputs use the same validation rules as saved configuration and drafts. Constraints appear before you type. Local guidance updates while editing, and an invalid submission shows a labeled error immediately below the input without advancing. Rejected npm registry values are cleared rather than echoed back because they may contain credentials. Earlier accepted answers remain in the private draft. Cancelling an unfinished questionnaire preserves that draft without replacing an existing complete configuration.

If a draft or configuration write fails, the wizard waits while you repair disk space or permissions, then retries the same save. It keeps the previous good draft and in-memory answer and does not start further cloud changes while saving is blocked. An unreadable or unsupported draft is preserved; explicitly starting over archives it before collecting new answers.

Failed read-only region/provider lookups offer a retry after you check sign-in, permissions, or connectivity in a separate terminal. Retry keeps the selected tenant and subscription. Ctrl+C still cancels. Unknown failures and operations with ambiguous ownership, provisioning, or migration state stop with recovery instructions rather than automatically repeating potentially unsafe changes.

### Local diagnostics

Every setup run writes a private JSONL diagnostics file under `logs/` beside the selected configuration. The default location is `infrastructure/.local/logs/`. The wizard prints the exact file path after completion or failure. Directories use permissions 0700 and files use 0600; an existing shared or symlinked logs directory is refused.

OpenTelemetry records the run, its phases, and individual command or prompt steps. Pino writes start records immediately and completed spans with trace/parent IDs, elapsed time, outcomes, and command exit codes. A start without a matching completion identifies an interrupted step. Each command invocation has its own span, including repeated attempts. These are local JSON records, not an OTLP export.

Telemetry never contains configuration answers, resource names, command arguments, environment values, UI messages, command output, exception messages or stacks, credentials, or deployment consent. Command names come from a fixed catalog; unknown commands use a generic identifier. No collector, network export, or environment-driven remote exporter is enabled. Files remain until you remove them; they are separate from drafts, Terraform state, and cloud leases.

Failed commands show their actual stderr to the local operator, limited to 64 KiB with terminal-control sequences removed. Those details may be sensitive: review them locally before sharing terminal captures. Successful command output is returned only to the caller, including token and secret lookups, and is not automatically printed. Neither successful output nor failed diagnostics enter telemetry or drafts.

If diagnostics cannot be created or written, setup reports the problem rather than continuing without logging. Existing cloud changes and recovery requirements still apply.

### Recovering image builds

A failed image build or publication stays in the interactive wizard. A short error notice keeps recovery controls visible even for long Docker logs and states whether a container npm proxy is configured. Choose **Retry image build and publication**, **Set or change the npm proxy, then retry**, **Show full error details**, or **Exit and keep saved progress**. The details view includes the original local error and complete selected registry, supports terminal scrolling, and returns to recovery without retrying. Registry editing is available when setup can save the corrected setting and the terminal supports field input.

For npm connection errors, check whether the error names a blocked public registry or an unavailable proxy. Get the correct HTTPS endpoint from your package-feed administrator and set it through the recovery option. For source compilation errors, repair the checkout before retrying. For Docker or ACR failures, restore Docker/Buildx, connectivity, or registry push access before retrying.

A corrected proxy is validated and saved to both the draft and complete configuration before another build starts. Retry rechecks source revision and dirty-checkout consent, signs in to ACR, and builds/publishes a new candidate image. Each attempt uses fresh metadata and accepts only a valid immutable digest; failed attempts cannot supply a stale result. A previous attempt may have left a candidate image in ACR.

The current installation lease stays held while you repair and retry. The wizard does not repeat Terraform, rotate stored credentials, run database setup, or clear locks for an image retry. Exiting retains saved answers and the existing lease for normal interrupted-installation recovery. Cancellation stops immediately, and non-interactive execution never retries or edits settings automatically.

### Azure discovery failures

The wizard names each region and provider lookup before running it. Region discovery uses a read-only ARM request with the selected subscription in both the URL and authentication context; it does not change your Azure CLI default subscription.

If a lookup fails, the error includes its step name, process exit status, and bounded stderr. The private diagnostics file identifies the failed step without recording those error details. To investigate further, replace `SUBSCRIPTION_ID` with the selected subscription and run the matching read-only command in a separate terminal:

```sh
az rest --method get \
  --url "/subscriptions/SUBSCRIPTION_ID/locations?api-version=2022-12-01" \
  --subscription SUBSCRIPTION_ID --query value --output json

# For a provider lookup, use the namespace named in the failed step.
az provider show --namespace Microsoft.App \
  --subscription SUBSCRIPTION_ID --output json
```

Check sign-in and subscription access if Azure reports an authentication or authorization error. Review diagnostic output locally; do not paste tokens or credentials into logs or issue reports. These discovery failures happen before the wizard saves a new configuration or provisions resources.

### Interrupted installation

The wizard holds an infinite lease on `terraform/INSTALLATION_NAME/installer.lock` in the state account across provisioning and release. A failed or cancelled installation retains that lease. Fresh-database provisioning additionally holds the normal `releases/deployment.lock`; a failed release retains its existing release lease too. These locks are deliberately not cleared automatically.

Interactive setup offers **Recheck without clearing the lock**, **Clear lock and continue (after safety checks)**, or **Exit and keep saved progress** when it finds a retained operational lock. Choose **Clear lock and continue (after safety checks)** to run the safety checks and then confirm clearing only the selected lock. Resources and saved progress are kept. **Recheck without clearing the lock** only checks whether its owner has released it.

This works during first-time setup and after an app or database exists, including a retained release lock before the maintenance-window release. Finite, changing, or unknown leases cannot be cleared through this flow.

Recovery checks installation ownership, Terraform state leases, every job execution in the app group, and every app revision and replica, including inactive revisions. Active jobs, active revisions, remaining replicas, unknown metadata, failed checks, or locked Terraform state block recovery. The wizard keeps the blocker and its next steps beside the recovery choices so you can repair the issue and recheck without restarting. It does not stop jobs or Hub, force-unlock Terraform, or bypass ownership checks. An active Hub must enter an authorized maintenance window and have its revisions deactivated before lock recovery; the wizard names the relevant Azure portal page.

Azure cannot prove that a previous installer or Terraform process on another machine has stopped or that database sessions have ended. Before authorizing recovery, verify every previous installer/release process has exited. For an existing app group, also verify old provisioning/setup/migration database sessions have stopped and review partial migrations, database ownership, and temporary provisioning grants. Use the exact setup or provisioning job named in the checks to review its execution history; review PostgreSQL sessions through your authorized private-network database administration connection. Do not clear a lock if those checks cannot be completed.

After explicit confirmation, the wizard repeats its checks, breaks only the selected installation or release lease, verifies that Azure reports it unlocked, and continues through normal lock acquisition. A declined confirmation returns to recovery choices. Break failures are surfaced and rechecked, never automatically repeated. No recovery consent is saved in drafts or telemetry. Non-interactive runs never enter this flow or clear retained locks.

For manual recovery after the same review, an authorized operator can use `az storage blob lease break --account-name ACCOUNT --container-name CONTAINER --blob-name BLOB --auth-mode login --lease-break-period 0 --subscription SUBSCRIPTION`. Use the exact coordinates printed by the wizard; never break an active installation's lease.

Resume setup restores answers, not prior approval or a position from which commands can be replayed. It revalidates choices before offering lock recovery at the relevant operation. The installer reconciles Terraform and reuses stored credentials. Clearing a lease does not repair ambiguous database state: if a provisioning execution exists without its Key Vault completion marker, setup still stops rather than rerunning fresh-database SQL. Inspect the exact execution and database roles before a reviewed repair. A successful provisioning transaction interrupted before marker creation also requires that explicit review.

Generated backend files remain usable with the existing manual release tooling. Do not destroy the foundation or state account when removing an app without separately authorizing loss of images, secrets, and state history. Key Vault purge protection deliberately prevents immediate permanent deletion of secrets.

### Local checks

```sh
npm run typecheck --prefix infrastructure
npm test --prefix infrastructure
```

The checks cover terminal cloud selection, searchable lists, tenant-scoped subscription selection, private configuration, command redaction/cancellation, Terraform plan guards, and mocked Azure installation ordering. CI also validates and tests each Terraform module. They do not prove an Azure deployment. An authorized tenant exercise must still establish RBAC/network propagation, identity-based pulls and secret resolution, database TLS, interruption recovery, maintenance behavior, and backup restoration.

### Terminal design patterns

The [installer terminal design guide](docs/terminal-design.md) records the working patterns for layout, field feedback, semantic notices, progress, timing, and private sessions. It explains module boundaries and the evidence expected when evolving these patterns.

## Manual reference

Operators can provision a durable Hub, run setup before every release, and replace the image without replacing its database or artifacts. This reference chooses Terraform with AzureRM to follow the team's Terraform experience; it is an implementation choice, not an application dependency. The configuration is flat under [`azure/`](azure/) rather than split into one-resource modules.

Definitions are grouped by responsibility: [`networking.tf`](azure/networking.tf), [`database.tf`](azure/database.tf), [`storage.tf`](azure/storage.tf), [`roles.tf`](azure/roles.tf), [`environment.tf`](azure/environment.tf), [`application.tf`](azure/application.tf), and [`setup.tf`](azure/setup.tf). Shared tags and the resource group remain in [`main.tf`](azure/main.tf). These files form one Terraform module; moving declarations between them does not change resource addresses or require state migration.

This installs the current Hub, not hosted previews, review collaboration, user admission, or a sign-in provider. A public HTTPS endpoint does not authorize users or isolate prototype previews. Confirm product access requirements before exposing sensitive data.

## What is created

Each installation has its own resource group tagged with its application, installation name, owner, and Terraform ownership. It contains:

- A virtual network, delegated Container Apps and PostgreSQL subnets, and private PostgreSQL DNS.
- PostgreSQL Flexible Server, the `replica` database, enforced secure transport, and configurable point-in-time recovery retention.
- An Azure Storage account with private `artifacts` and `releases` containers, Blob versioning, and 14-day Blob and container soft deletion. Shared keys and anonymous access are disabled. The Blob endpoint is public-network reachable but requires Entra authorization; this is not a private-endpoint installation.
- Separate Hub and setup user-assigned identities. Only Hub receives `Storage Blob Data Contributor` on the artifacts container. Each identity can read only its referenced Key Vault secrets and, when configured, pull from an existing ACR. No vault or registry is created or owned.
- Log Analytics with 30-day retention, a Container Apps environment, a manual setup job, and, after successful setup, one combined Hub app.

The app has external HTTPS ingress and minimum and maximum one replica **per revision**. Multiple-revision mode permits explicit deactivation before releases. Azure's single-revision mode deliberately overlaps old and new processes while readiness is checked, so it is unsuitable for this maintenance-window strategy. Do not activate old revisions alongside the combined worker. This is not a high-availability or zero-downtime installation.

The runtime receives `RUNTIME_MODE=combined`, `HOST=0.0.0.0`, `PORT=3001`, `CLIENT_DIRECTORY=/app/dist/client`, `SHUTDOWN_TIMEOUT_MS=30000`, and `NODE_ENV=production`. Artifacts use `ARTIFACT_STORAGE_PROVIDER=azure`, the provisioned `AZURE_STORAGE_ACCOUNT`, `AZURE_STORAGE_CONTAINER=artifacts`, and Hub's `AZURE_CLIENT_ID`. `DATABASE_URL` references a Key Vault secret for the `replica_runtime` database role with `sslmode=verify-full`. Optional `runtime_secret_references` map environment names to vault resource IDs and HTTPS secret URLs. Container Apps resolves these references using Hub's identity; Hub does not implement a separate secret-resolution framework.

The setup job uses the same digest and command `node dist/server/scripts/setup/index.js`. Its only environment settings are `NODE_ENV=production`, `RUNTIME_MODE=setup`, `DATABASE_RUNTIME_ROLE=replica_runtime`, and its own Key Vault-backed `DATABASE_URL` for `replica_migration`. It receives no artifact configuration or additional runtime secrets. It has one replica, no automatic retries, and a 30-minute timeout. Hub's readiness probe is `/api/ready`; startup and liveness use `/api/health`. Azure allows 60 seconds for termination, covering the 30-second application drain and up to five seconds of telemetry flushing with platform margin.

Neither workload receives the PostgreSQL administrator credential. A separate, one-time operator script provisions the migration and runtime roles over the private database network. Setup owns schema changes and refreshes the runtime's data permissions after migrations. See [database access](../hub/docs/database.md#deployment-database-roles). Managed identity is used for Blob, Key Vault, and ACR, not database authentication.

## Prepare access and protected state

Use the Terraform version constrained in [`versions.tf`](azure/versions.tf), a Node.js version supported by `scripts/package.json`, and a current Azure CLI with Container Apps job and revision commands. CI performs formatting, validation, mocked Terraform tests, and release-orchestration tests without cloud credentials. It does not deploy.

An authorized administrator must first create the **separate** Terraform backend: a dedicated state resource group, Storage account, and private container. Enable TLS, Entra authorization, Blob versioning and soft deletion; disable shared-key authorization and anonymous blob access, and grant the deployment identity `Storage Blob Data Contributor` on the state container. An IP allowlist is not required by the guided flow. Apply additional network restrictions only when required by your deployment policy and ensure the runner can reach the account. These bootstrap resources are not part of this installation's state or teardown. Never store this state in the app's artifacts account.

For automation, configure a dedicated deployment identity with a federated workload identity credential rather than a client secret. Bind its issuer to `https://token.actions.githubusercontent.com`, audience to `api://AzureADTokenExchange`, and subject to the exact protected repository/environment, such as `repo:YOUR_ORG/YOUR_REPO:environment:hub-production`. Protect that environment and deployment branch. A future release workflow needs `id-token: write` and must authenticate Azure CLI as the same identity; the infrastructure-check workflow intentionally has no such permission.

Set `ARM_CLIENT_ID`, `ARM_TENANT_ID`, `ARM_SUBSCRIPTION_ID`, and `ARM_USE_OIDC=true` in that authorized runner. Terraform's AzureRM backend supports GitHub's OIDC request environment; other runners must supply their supported OIDC token source. For local authorized operation, use Azure CLI sign-in and set `use_oidc=false` in your private backend configuration instead. Do not copy tokens into Terraform inputs.

The deployment identity needs resource creation/update rights for the installation, role-assignment rights for the artifact container, referenced Key Vault secrets and optional registry, and Blob data-plane rights on the installation's account for the lock blob. Resource `Contributor` alone does not grant data access or role assignment. An administrator must authorize initial resource-group creation and inherited Blob data access for bootstrap, then narrow ongoing deployment grants to the installation resource group, referenced secrets, existing registry, and backend container. Precreated/imported infrastructure needs a separately reviewed initial plan rather than the empty-state bootstrap command. Do not grant either workload identity deployment or state access.

Register `Microsoft.App`, `Microsoft.OperationalInsights`, `Microsoft.Network`, `Microsoft.Storage`, `Microsoft.DBforPostgreSQL`, and `Microsoft.ManagedIdentity` beforehand. The provider does not register services across the subscription. Allow time for newly assigned RBAC roles to propagate before setup.

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

Plans reject resource deletion and replacement during normal releases. A database major upgrade, region move, rename, or replacement needs a reviewed migration/recovery plan, not an override of that guard. The release script deletes its sensitive saved plan on exit. It leaves Hub stopped and retains the infinite lease after any release failure; it never reactivates an older process automatically against a possibly migrated schema.

### Recover a failed release

Inspect the named setup execution and Container Apps/Log Analytics logs using authorized Azure access. Check that the release process has exited, every setup execution is terminal, and no old revision still has replicas. After a successful but partially deployed setup, decide whether to retry the same digest or use a compatible recovery image. Prisma migrations, queue migrations, and schedule registration are not a single atomic transaction.

Confirm that the prior migration database sessions have also stopped before retrying, including after a lost setup-lock connection. Guided setup provides the interactive recovery checks described above before invoking a new release. For manual releases, only after those checks may an operator break the retained lease:

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

Terraform tests use AzureRM mocks, not an Azure subscription. Orchestration tests replace command execution and HTTPS requests, proving ordering and failure gates rather than Azure behavior. Readiness includes a bounded, non-writing container-properties request through Hub's managed identity; it detects unavailable storage but does not prove write or delete authorization. Worker readiness remains initialization-only. Before production, an authorized tenant exercise must verify provisioning, private PostgreSQL connectivity and TLS, separate database roles, Key Vault resolution, identity-based Blob/ACR access after RBAC propagation, failed setup blocking rollout, maintenance shutdown and revision behavior, HTTPS/readiness, persistence across replacement, custom TLS when configured, backup restoration, and owned-resource teardown. No real-cloud result is implied by these local checks.

The release command and its tests are TypeScript running directly in Node.js. Terraform's own tests use `.tftest.hcl`; neither requires Python. From the repository root, `npm run typecheck --prefix scripts` checks the TypeScript operational scripts as well.

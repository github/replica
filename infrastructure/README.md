# Azure Hub installation

## Guided installation

Interactive setup starts with **Create a new installation**, **Update existing installation**, **Resume in progress setup** when a compatible unfinished draft is known, and **Exit and do nothing**. The menu uses read-only local discovery before creating diagnostics, drafts, directories, or writer locks, and before running Azure or prerequisite commands. Choosing Exit performs no additional local writes or Azure operations.

Create starts with fresh answers and a fresh configuration/draft path. It does not load or discard an earlier installation's answers. Update lists local configurations and lets you enter a config-file path. Resume selects the associated unfinished draft and configuration. Picker labels show the installation name, subscription, region, and file path; saved configuration is not proof of an Azure deployment. Invalid, untrusted, or conflicting files remain visible as needing attention and are preserved.

New setups then ask which cloud to use. Azure is available; AWS is shown as unavailable with "Coming soon". The themed Ink interface lives in `installer/`, above the cloud-specific directories. Azure configuration and orchestration live in `azure/install/`; reusable Terraform execution lives in `terraform/`. Terraform resources are grouped into separate Azure root modules: `azure/foundation/` owns the registry and vault, `azure/` owns the running installation, and `azure/provision/` owns temporary database provisioning. None of these Terraform modules depends on Ink or React.

The terminal is a front end to independently usable Terraform modules. Keep resource definitions, dependencies, and reconciliation in Terraform. The wizard collects and saves inputs, invokes the modules, and presents plans, approval, progress, and recovery. State-backend bootstrap, credential handling, image publication, and serialized database/release operations remain explicit orchestration boundaries; they must not duplicate Terraform-managed resources or repair them outside Terraform.

Every full-screen launch welcomes you with a cyan ASCII GitHub mark and magenta Replica wordmark above the entry menu, including when saved configurations or drafts exist. Larger terminals show block lettering; smaller ones keep a compact mark and name. The art disappears after your first answer and is omitted when the terminal is smaller than 60 columns by 24 rows. A compact stage map shows progress, while an elapsed counter stays in the footer. The counter measures this run, including time waiting for you; it restarts after the process restarts. Errors and warnings are labeled and colored separately from muted operational activity.

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

Creating a new installation asks for an Azure tenant, then lists only that tenant's enabled subscriptions. Regions must be advertised for all four required services and advertise the guided PostgreSQL SKU and major version. The wizard checks subscription-scoped PostgreSQL catalogues with at most four requests in flight, caches successful lookups for the run, and does not silently drop or accept failed lookups. Type a name or ID to filter each list, use Up/Down to scroll, and press Enter to select. Each list shows matching and total counts and how many options are visible at a time.

The guided PostgreSQL profile lives in [`azure/install/profile.ts`](azure/install/profile.ts). New region filtering and generated Terraform inputs use the same explicit SKU/version, rather than relying on separate implicit defaults. Before deployment, the wizard checks the actual retained SKU/version for the fixed region and shows those settings in the deployment review. Existing configurations keep their saved tenant, subscription, and region; an unsupported result stops before cloud changes instead of choosing a replacement.

These are advertised-compatibility checks, not a reservation or guarantee of capacity, quota, or policy approval. SKU-specific filtering currently covers PostgreSQL; the other fixed service configurations retain provider-region checks. A listed region can still return `SkuNotAvailable` during creation. Missing or malformed capability data means compatibility could not be verified, not that the region is compatible. After a partial apply, do not change the existing installation's region or discard state: another region requires a separate installation and review of any resources and charges left by the failed attempt.

Tenant choices come from subscriptions in your current Azure CLI sign-in, using the tenant name or domain when Azure provides it. Tenants without an enabled subscription and tenant-only sign-in accounts are not deployment targets. If a tenant is missing, sign in with `az login --tenant TENANT_ID` in a separate terminal, then restart the wizard. The installer does not automate sign-in or install the experimental Azure CLI account extension.

New installations then ask for the installation name and owning team or person. The app resource group is set automatically to `<installation-name>-hub`, without a separate question, and shown in the deployment review. Existing configurations and previously accepted draft answers keep their saved resource group, including custom names. Updates display the saved values and keep them fixed instead of asking editable identity questions. The owning team or person is a label saved in configuration and Azure resource tags; it does not assign billing or permissions or send notifications. Each text answer is validated before moving to the next question. The wizard explains invalid values and lets you correct that field without repeating earlier answers. Your subscription must still have sufficient quota and permission to deploy in the chosen region. The wizard does not bypass denied permissions or subscription policy.

Before provisioning, one deployment review shows the target and the installation-owned resources that may be created or updated: state storage, registry and Key Vault, networking, PostgreSQL, artifact storage, workload identities and grants, Container Apps jobs and Hub, and logs. It explains ongoing charges, publication of the local source including uncommitted Hub and learning runtime changes, maintenance downtime and database setup, and removal of the temporary provisioning job, identity, and grants. Choose **Agree and continue** once to authorize this normal deployment flow, or decline before cloud changes.

The review fingerprints the repository-root image context selected by `hub/Dockerfile.dockerignore`, including Hub and the learning runtime. Publication compares a new private copy against that fingerprint, then builds from the copy with `hub/Dockerfile`. Changed build inputs require fresh approval; excluded files, such as private learning stores and local configuration, are not copied.

Terraform still generates and displays plans and blocks deletion or replacement of persistent resources. Safe normal plans, temporary provisioning cleanup, image publication, and the final maintenance-window release do not ask for routine confirmation again. Approval applies only to this run and is never saved in configuration or drafts. The review includes the single bounded infrastructure retry described below. Other or repeated failures still use the existing recovery choices and fresh-plan approval. Retained-lock recovery and changes to existing state-network restrictions keep their separate safety checks and consent.

The signed-in identity needs resource creation and role-assignment rights, permission to register the required providers, and access through applicable Azure network policies. An administrator may need to grant these rights. Resource Contributor alone is insufficient.

The guided flow creates a tagged state resource group/account first, with shared-key authorization and anonymous blob access disabled, TLS, identity-based data access, versioning, and soft deletion. Its public network endpoint accepts requests from any network, but reading or changing state still requires Azure authentication and Blob data permissions. The wizard does not require an IP address, CIDR, or external IP lookup. These bootstrap resources remain outside application Terraform state. Do not reuse this backend for unrelated installations.

The wizard grants its signed-in deployment identity `Storage Blob Data Contributor` on the dedicated state account, then checks an actual Blob read before acquiring the installation lease. Subscription `Owner` and successful container creation do not prove Blob data access; a new account-scoped grant can take time to propagate even when earlier installations worked. A failed access check offers a recheck without replaying successful container creation or touching leases. Check the named account scope, current Azure CLI identity, Blob data role, and network policy if access stays denied. Do not add a subscription-wide data role, enable account keys, or clear a lease to bypass a read failure.

If an earlier installer created an IP-restricted state account, the wizard verifies its ownership and authentication settings, then asks interactively before switching to authenticated access without the network restriction. Unattended runs refuse this change; `--approve-deployment` is not consent to remove network restrictions. It verifies the resulting settings before using state storage. It will not override disabled public access, a network perimeter, or an account with different ownership or unsafe authentication settings. If your organization requires private networking, use an authorized deployment path rather than bypassing that policy.

It then uses separate protected Terraform state files for the foundation, application, and temporary provisioning modules. Foundation resources include an ACR and an RBAC-enabled, purge-protected Key Vault. Passwords are generated independently and written to Key Vault using private temporary files, never command-line values. Existing credentials are reused, not silently rotated. The PostgreSQL administrator password still enters protected application Terraform state.

The wizard builds and pushes a Linux AMD64 image and deploys its immutable digest. On first installation, Hub remains absent while a separate private-network job initializes the database roles. This job has its own temporary managed identity and secret-scoped administrator/password access; neither Hub nor normal setup receives administrator access. After success, the wizard records completion in Key Vault and destroys the temporary job, identity, and grants before invoking the existing serialized release procedure.

The final release stops old revisions, runs migrations and schedule setup, starts Hub, and checks HTTPS readiness. Readiness is not authorization. After installation, use the separate [post-setup menu](#post-setup-configuration) to enable setup access and GitHub sign-in without another build or database setup. Artifact import, hosted previews, and reviews are not available yet.

### Saved configuration and repeat runs

Create saves non-secret choices in a uniquely named ignored `infrastructure/.local/installation-UUID.json`. If `--config FILE` names an unused configuration/draft path, Create uses it; if that path is occupied, Create uses a new uniquely named file beside it. Exclusive first saves refuse a file that appears after selection rather than overwriting it. Previous configurations, drafts, and local writer records are kept. Creating a new configuration does not authorize adopting or overwriting Azure resources; normal collision and ownership guards still apply.

Update and Resume discover JSON configurations and companion drafts directly under `infrastructure/.local/`, including older `installation.json` files. Use the config-file path option for files stored elsewhere; `--config FILE` adds that path to the picker. If Update discovers an unfinished draft at an explicit path, it returns to the entry menu with Resume available. Update does not discard or consume an unfinished draft: resume it instead. Repair an invalid or conflicting file, or preserve and move it out of the selected path after reviewing it, before reusing that path. Create can start independently without changing any of those files.

Private generated inputs and Terraform working directories live beside the configuration in `INSTALLATION_NAME-TARGET_HASH/`. The hash identifies the cloud, normalized tenant and subscription IDs, installation name, region, and case-normalized app resource group. Interactive and unattended runs use the same path. Separate targets cannot share generated files; adjacent configurations for the same target share a local workspace writer lock in addition to the Azure leases.

Keep the configuration directory private and owned by the current user (0700). Existing generated files must be private regular files (0600), not symlinks or hard links. Setup refuses shared, untrusted, or redirected paths without changing their permissions or contents. Start from [`installation.example.json`](installation.example.json) if you prefer to fill out the JSON yourself. Real configuration files belong under the ignored `.local/` directory, not beside the tracked example. The root shortcut runs the wizard from `infrastructure/`, so relative `--config` paths are resolved from that directory.

An existing name-only workspace such as `.local/INSTALLATION_NAME/` blocks deployment before cloud changes. Do not delete it or start with empty state. After stopping prior local installer processes, independently verify the saved subscription, tenant, installation, owner, and backend state keys against the intended configuration. Preserve a private backup and move that verified workspace to the target-specific path printed by setup. Review its private inputs and Terraform backend before rerunning. A mismatch or ambiguous workspace needs manual recovery rather than automatic adoption. This local migration does not clear any cloud leases.

Updates preserve validated optional inputs already stored in the workspace's `installation.tfvars.json`: Hub's public origin, GitHub App identifiers and provider revision, `runtime_environment_variables`, `runtime_secret_references`, PostgreSQL SKU and major version, backup retention, and the custom hostname/certificate pair. Runtime environment values must be strings with valid, non-credential names and cannot override deployment-owned settings or share names with secret references or named GitHub settings. Runtime references must match the main module's environment-name and Key Vault rules and must not reference the migration credential. Other customizations or invalid inputs stop setup before cloud changes or input rewrites. Review changes to immutable infrastructure through the existing Terraform guards; retaining a setting is not approval to replace resources.

Set `hub_application_origin` to an exact HTTPS origin such as `https://hub.example.com`, with a lowercase host and no default `:443` port, path, query, fragment, credentials, or trailing slash. A non-default port is allowed. Hub authentication requires this origin, including when using the default Container Apps hostname. The origin, `HUB_AUTHENTICATION_ENCRYPTION_KEY`, and `HUB_BOOTSTRAP_SECRET` must be configured together; supply the shared keys through `runtime_secret_references`. An unauthenticated or Copilot-only installation can leave all three unset.

With `REPLICA_COPILOT_AUTHENTICATION=github-app-installation`, supply `GITHUB_APP_ID`, `REPLICA_COPILOT_GITHUB_INSTALLATION_ID`, `REPLICA_COPILOT_GITHUB_ORGANIZATION`, and a secret reference for `GITHUB_APP_PRIVATE_KEY` or `GITHUB_APP_PRIVATE_KEY_BASE64`. The Copilot installation ID must be a positive number and the organization must be a valid GitHub organization login. This mode does not require GitHub sign-in settings or `GITHUB_APP_INSTALLATION_ID`, which belongs to sign-in. Secret references satisfy presence checks; Hub validates their resolved values at startup.

```sh
# Collect and save configuration without creating cloud resources.
npm run setup:server -- --configure-only

# Add a saved configuration to the interactive Update/Resume picker.
npm run setup:server -- --config .local/installation.json

# Explicit approval for automation includes publication, Terraform changes,
# temporary provisioning cleanup, and a maintenance window.
npm run setup:server -- \
  --config .local/installation.json \
  --non-interactive --approve-deployment
```

Non-interactive execution requires complete configuration and a clean source checkout, and fails with instructions when a prerequisite requires human action. It bypasses the interactive entry menu and never consumes a draft. Unattended deployment approval does not authorize publishing uncommitted source or changing state network restrictions. Rerun interactively to include working-tree publication in the deployment review or review the separate network-policy decision. It does not answer missing configuration questions or escalate access. Interactive updates keep the installation name, owner, tenant, subscription, region, and app resource group fixed. Lost access requires restored access, not retargeting the saved installation. Use Create for another installation. Tenant and subscription UUIDs are canonicalized to lowercase across configuration, drafts, discovery, and deployment. Normal updates use the existing release orchestrator; the wizard never directly applies the full application configuration to an installed Hub.

You can reopen the wizard while Hub is running, but a deployment or update is a maintenance-window operation, not a no-downtime rerun. Each run's initial deployment review includes permission to stop old revisions and run setup; it does not ask again at the normal release step. A failed attempt may have left Hub running with retained leases; those leases still require the [interrupted-installation recovery checks](#interrupted-installation). Restarting does not clear them or inherit permission to stop workloads.

Interactive runs also save a private companion draft at `<config path>.draft.json`, such as `.local/installation-UUID.json.draft.json`. Each accepted answer and phase transition is saved before continuing. On restart, the entry menu offers Resume only when a compatible unfinished draft is known. Its picker shows the target, configuration path, and last-save time. Resume rechecks Azure access and available choices, then returns to the first unresolved question. Changed parent choices invalidate dependent answers without discarding independent settings, unless a complete saved configuration fixes those choices. A conflicting draft and configuration are preserved for review rather than silently choosing one. An interrupted deployment with a missing saved configuration requires that file to be restored before resuming; it cannot restart from empty state.

Drafts contain only validated non-secret choices, not raw keystrokes, search queries, command output, credentials, or consent for cloud changes. A draft does not replace complete deployment configuration or prove that a resource operation succeeded. Resume obtains fresh deployment and recovery consent through the existing checks; it never jumps to a recorded command or clears cloud leases. Successful configuration-only or deployment completion removes only the selected draft and keeps the reusable configuration. Unselected drafts remain unchanged.

The local `<config path>.draft.json.lock` allows one interactive writer per configuration. An exited process on the same host can be recovered automatically. An active writer, an unknown owner, or a malformed writer record blocks reuse with instructions. If a crash leaves a `.lock.recovery` record, verify the recorded owning process has exited before reviewing and removing that exact local recovery file. These local files are not the Azure installation or release leases described below.

Older version-1 configuration files may contain `azure.stateAllowedIp`. That obsolete setting is accepted but ignored, and is omitted when the configuration is saved again.

The wizard only reuses resources owned by this installation and matching its Terraform state. It does not automatically adopt existing shared registries, vaults, or unrelated resource groups. Use the manual reference below when connecting an externally managed registry, vault, backend, or an existing installation not created by this wizard.

### Deployment result

A successful installation or update prints a report in your normal shell after restoring the terminal. Interactive and non-interactive runs use the same report: service URL, installation name, Azure subscription and tenant, region, immutable image digest, and saved configuration path. It also lists the application resource group, Hub app, Container Apps environment, PostgreSQL server, artifact storage, registry, Key Vault, and Terraform state account with links to their Azure portal pages.

Resource links use IDs from Terraform outputs and the existing verified Azure state-account inspection, not reconstructed naming conventions. The report contains no credentials and is not added to telemetry or drafts. It appears only after readiness, installation/release lease release, and entry-point cleanup succeed. Invalid or incomplete metadata stops setup with an error instead of printing a misleading success report. Configuration-only runs report the saved file without claiming a deployment.

Readiness remains a technical check, not proof that manually configured sign-in or authorization works. An earlier deployment's URL or a running revision does not prove that a later failed update completed.

### Correcting answers and retrying lookups

Installation name, ownership label, and npm registry questions use the same validation rules as saved configuration and drafts. The automatic resource group and any manually supplied configuration still pass the shared resource-group validation. Constraints appear before you type. Local guidance updates while editing, and an invalid submission shows a labeled error immediately below the input without advancing. Rejected npm registry values are cleared rather than echoed back because they may contain credentials. Earlier accepted answers remain in the private draft. Cancelling an unfinished questionnaire preserves that draft without replacing an existing complete configuration.

If a draft or configuration write fails, the wizard waits while you repair disk space or permissions, then retries the same save. It keeps the previous good draft and in-memory answer and does not start further cloud changes while saving is blocked. An unreadable, untrusted, or unsupported draft is preserved and reported as needing attention. Create uses a fresh path rather than archiving, deleting, or replacing the old draft.

Failed read-only region/provider lookups offer a retry after you check sign-in, permissions, or connectivity in a separate terminal. Retry keeps the selected tenant and subscription. Ctrl+C still cancels. Unknown failures and operations with ambiguous ownership, provisioning, or migration state stop with recovery instructions rather than automatically repeating potentially unsafe changes.

### Local diagnostics

After a non-exit entry action selects trusted setup files and acquires its local writer, the run writes a private JSONL diagnostics file under `logs/` beside the selected configuration. Exit and read-only entry discovery create no diagnostics. Non-interactive deployment writes diagnostics after accepting its explicit configuration and approval. The default location is `infrastructure/.local/logs/`. The wizard prints the exact file path after completion or failure. Directories use permissions 0700 and files use 0600; an existing shared or symlinked logs directory is refused.

OpenTelemetry records the run, its phases, and individual command or prompt steps. Pino writes start records immediately and completed spans with trace/parent IDs, elapsed time, outcomes, and command exit codes. A start without a matching completion identifies an interrupted step. Each command invocation has its own span, including repeated attempts. These are local JSON records, not an OTLP export.

Telemetry never contains configuration answers, resource names, command arguments, environment values, UI messages, command output, exception messages or stacks, credentials, or deployment consent. Command names come from a fixed catalog; unknown commands use a generic identifier. No collector, network export, or environment-driven remote exporter is enabled. Files remain until you remove them; they are separate from drafts, Terraform state, and cloud leases.

Failed commands report a safe operation label and exit status by default, including in unattended output. Raw stderr is held privately in memory, limited to 64 KiB with terminal-control sequences removed. It is shown only after an interactive **Show full error details** choice in a supported recovery menu. Those details may be sensitive: review them locally before sharing terminal captures. When setup exits after a failed command, it also prints the last 20 lines (at most 4,000 characters) of those details below the error; the diagnostics log does not include them. Known read-only Azure and Terraform checks, such as listing or showing resources and reading Terraform state or outputs, retry up to twice after recognized transient network or service errors (timeouts, connection resets, throttling, or 5xx responses), waiting 2 and then 5 seconds. Every reported error must be transient; authorization, lease, state-save, missing-resource, and safety errors prevent retries even when another error reports a timeout or service failure. Commands that can change resources, cancelled commands, and other errors are never retried automatically. Successful command output is returned only to the caller, including token and secret lookups, and is not automatically printed. Neither successful output nor failed diagnostics enter telemetry or drafts.

On cancellation or output-limit termination, setup signals the owned command process group and waits for its exit or bounded kill escalation even if the direct child exits first. If signalling or inspection fails, it reports a cleanup failure rather than claiming work stopped. Verify that owned commands and descendants have stopped before retrying.

The serialized release tool keeps raw child errors and output private because they can contain credentials or lease IDs. Its errors identify the failed operation through the shared static command catalog and include a nonzero exit code when available.

If diagnostics cannot be created or written, setup reports the problem rather than continuing without logging. Existing cloud changes and recovery requirements still apply.

### Recovering image builds

A failed image build or publication stays in the interactive wizard. A short error notice keeps recovery controls visible even for long Docker logs and states whether a container npm proxy is configured. Choose **Retry image build and publication**, **Set or change the npm proxy, then retry**, **Show full error details**, or **Exit and keep saved progress**. The details view includes the original local error and complete selected registry, supports terminal scrolling, and returns to recovery without retrying. Registry editing is available when setup can save the corrected setting and the terminal supports field input.

For npm connection errors, check whether the error names a blocked public registry or an unavailable proxy. Get the correct HTTPS endpoint from your package-feed administrator and set it through the recovery option. For source compilation errors, repair the checkout before retrying. For Docker or ACR failures, restore Docker/Buildx, connectivity, or registry push access before retrying.

A corrected proxy is validated and saved to both the draft and complete configuration before another build starts. Retry rechecks source revision and dirty-checkout consent, signs in to ACR, and builds/publishes a new candidate image. Each attempt uses fresh metadata and accepts only a valid immutable digest; failed attempts cannot supply a stale result. A previous attempt may have left a candidate image in ACR.

The current installation lease stays held while you repair and retry. The wizard does not repeat Terraform, rotate stored credentials, run database setup, or clear locks for an image retry. Exiting retains saved answers and the existing lease for normal interrupted-installation recovery. Cancellation stops immediately, and non-interactive execution never retries or edits settings automatically.

### Recovering Terraform steps

A failed Terraform initialization stays in the interactive wizard with **Retry Terraform initialization only**, **Show full error details**, and **Exit and keep saved progress**. Review the details locally to identify backend access, network, or provider-download failures. Initialization waits up to 60 seconds for a Terraform state lock before failing. Viewing details does not retry. An explicit retry uses the same module, backend, and environment without planning or applying resources, restarting earlier steps, or clearing leases. Earlier bootstrap steps may already have created cloud resources. Cancellation and unattended failures stop without retrying.

A recognized failure during a preapproved infrastructure apply gets at most one automatic retry after a cancellation-aware 15-second delay. Eligible Terraform diagnostics are `SkuNotAvailable` for the installation's PostgreSQL server, a Blob authorization 403 for `deployment.lock`, and a managed-identity image-pull failure for the setup or provisioning job. Every reported error must match one of these cases; missing, truncated, or mixed unknown diagnostics return to manual recovery. These errors are only potentially recoverable: the retry does not prove that the problem is temporary.

The wizard removes the failed plan and generates and checks a new one against current state. Automatic apply requires unchanged input variables and Terraform configuration, and no resource changes beyond those proposed by the first plan. Deletion and replacement remain blocked. Changed inputs, configuration, or wider scope stop before automatic apply without printing their values. The retry keeps the same module, variables path, environment, image, and leases; it never restarts the installation or reruns database jobs or SQL.

This retry applies only to guided infrastructure provisioning, not cleanup/destroy, image publication, job execution, or the serialized maintenance-window release. It does not change the SKU, region, permissions, or network policy. A genuinely unsupported SKU or denied access still requires operator review. Unattended runs can use the same bounded retry, then fail without a recovery menu. Standalone Terraform consumers keep their existing per-plan approval and no automatic retry.

A failed command during normal Terraform planning, plan inspection, or apply offers **Replan and review this Terraform step**, **Show full error details**, or **Exit and keep saved progress**. A planning or plan-inspection failure applies no changes. An apply failure may have created some resources before returning an error, and the recovery message says which case occurred. The wizard does not roll back those resources or assume the failed apply completed.

The wizard removes the previous sensitive plan before offering recovery. A manual retry prepares a new plan against current state and asks for approval before applying remaining resource changes. It never reapplies the failed plan, replenishes the automatic retry budget, or restarts earlier installation steps. The installation lease remains held, deletion and replacement guards still apply, and database jobs and releases are not replayed. Cancellation, declined approval, unsafe or unreadable plan data, and temporary provisioning cleanup/destroy failures stop instead of entering this retry flow.

Terraform normally reconciles the configuration with saved state, including resources created before a partial failure. A proposed deletion or replacement is different from a failed command: the wizard blocks the plan before apply and names the affected resources and replacement-triggering attribute paths without showing their values. Review the configuration and state rather than bypassing that guard. No changes from the blocked plan were applied; earlier steps may have completed.

Azure chooses the Container Apps infrastructure resource-group name and PostgreSQL availability zone when this module leaves them unset. The Terraform resources preserve those service-assigned attributes on later plans instead of trying to remove them. This applies to manual Terraform runs too. Other resource settings, including workload images, remain reconciled normally; real deletions and replacements remain blocked by deployment orchestration.

The database subnet explicitly includes the `Microsoft.Storage` service endpoint that Azure adds for PostgreSQL log archival. Replanning must not remove this required endpoint.

For a Storage 403 while creating `deployment.lock`, inspect Blob data permissions as well as resource-management permissions. The wizard grants its deployment identity `Storage Blob Data Contributor` on the application storage account, but creating that role assignment does not mean Blob authorization has propagated. Terraform's dependency ordering waits for the role assignment resource, not for successful Blob data requests. After allowing propagation or repairing permissions, choose **Replan and review this Terraform step**. If access remains denied, check the selected identity, role scope and conditions, network rules, and subscription policy. Do not enable shared keys or change network policy to bypass a denial.

#### Lost write responses and untracked role assignments

An apply can fail after Azure accepted a write. For example, a role assignment `PUT` may succeed while the connection resets before Terraform receives the response, so saved state never records that resource. When an apply fails, the wizard classifies each error by resource address. It separates these cases:

- network or name-resolution failures that stopped a request from being delivered;
- permission denials;
- resources that Azure reports already exist but saved state does not record;
- other Azure conflicts, such as resource locks or another operation in progress;
- writes whose response was lost;
- failures to save state;
- unknown errors, including missing or truncated details.

A storage DNS failure in the same apply is reported separately as a network failure, not as a permission problem or lost state.

An existing resource, another conflict, a lost write response, or a state-save failure disables the automatic retry. The recovery message lists which affected addresses saved Terraform state records. It also gives the recorded resource count. An unreadable state listing is reported as unread, not as lost state.

A state-save failure means Terraform may have changed Azure without updating the backend state. The wizard then offers no replan or retry, because a new plan or import against the old state could fork it from the state Terraform saved locally. Recover state first:

1. Exit and keep the lease.
2. Confirm that no other installer or release is running.
3. Do not run a new plan or import. Do not delete, edit, or replace `errored.tfstate`, which Terraform writes in the module directory. It contains secrets, so keep it owner-only.
4. Take an owner-only private `terraform state pull` backup.
5. Run the printed `terraform state push` command. It pushes `errored.tfstate` to the same backend and workspace, using the same module and data directory.
6. Rerun the wizard only after the push succeeds.

If `errored.tfstate` is missing, do not rerun the wizard until saved state has been checked against Azure.

Every infrastructure plan in guided installation and provisioning, including replans, runs a read-only check. For each planned role-assignment creation, it lists assignments at the planned scope and inherited scopes, then compares scope and principal ID locally without regard to case; scope comparisons also ignore trailing slashes. Inherited grants, other principals, other role definitions, and scopes outside the saved subscription do not match. When the plan supplies a role definition ID, it must equal the full returned ID, not only its final GUID. The built-in `Key Vault Secrets User` role is an exception: its root and current-subscription IDs identify the same role, and its name is checked against that known ID even when the plan supplies only the name. A conflicting name and ID, or incomplete or malformed identifying information for a potential match, does not prove that a grant is absent.

If Azure already has that grant, the wizard blocks the plan before approval or apply and imports nothing. It shows the existing assignment ID and a manual recovery procedure:

1. Exit and keep the lease.
2. Confirm that no other installer or release is running.
3. Take an owner-only private `terraform state pull` backup.
4. Confirm the ID.
5. Run the printed `terraform import` command. It sets the same module, data directory, variables file, and lock timeout, and quotes each path for the shell. Set any `TF_VAR_*` environment variables the message names, such as the PostgreSQL administrator password, to this installation's values; the message names them without showing values.
6. Rerun the wizard and confirm the new plan has no deletions or replacements.

Do not delete the existing grant to make the plan pass. Within the same wizard run, a replan is blocked if a resource with an uncertain result cannot be checked. A failed check in a later run, or for any other resource, is reported and the plan continues; Terraform then reports a conflict instead of creating a duplicate grant. Planned role assignments whose principal is unknown until apply are not checked. Other resource types are not checked either.

### Azure discovery failures

The wizard names each region and provider lookup before running it. Region discovery uses a read-only ARM request with the selected subscription in both the URL and authentication context; it does not change your Azure CLI default subscription.

If a lookup fails, the wizard shows its step name and process exit status without displaying stderr. The private diagnostics file identifies the failed step without recording those error details. To investigate further, replace `SUBSCRIPTION_ID` with the selected subscription and run the matching read-only command in a separate terminal:

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

New acquisitions save a private proposed lease ID bound to the exact installation and blob before requesting the lease. A later run can reuse a retained lease only when renewal proves that same saved ID still owns it; a different, finite, or unknown lease remains blocked. This does not grant permission to break another owner's lease.

Interactive setup offers **Recheck without clearing the lock**, **Clear lock and continue (after safety checks)**, or **Exit and keep saved progress** when it finds a retained operational lock. Choose **Clear lock and continue (after safety checks)** to run the safety checks and then confirm clearing only the selected lock. Resources and saved progress are kept. **Recheck without clearing the lock** only checks whether its owner has released it.

This works during first-time setup and after an app or database exists, including a retained release lock before the maintenance-window release. Finite, changing, or unknown leases cannot be cleared through this flow.

Recovery checks installation ownership, Terraform state leases, every job execution in the app group, and every app revision and replica, including inactive revisions. Active jobs, active revisions, remaining replicas, unknown metadata, failed checks, or locked Terraform state block clearing. The wizard never force-unlocks Terraform or bypasses ownership checks.

When activity in the installation's Hub app is the only blocker, the wizard offers **Stop Hub for recovery and continue**. It verifies that app's actual Azure resource ID and ownership tags, not just its resource group's ownership. The action requires fresh downtime approval and confirmation that prior deployment processes and provisioning/setup/migration database sessions have stopped. It rechecks ownership, jobs, Terraform state, and the selected lease immediately before deactivating Hub's active revisions, then waits up to five minutes for every old replica to disappear, including replicas of inactive revisions. It does not delete the app or database, cancel jobs, replay SQL, or reactivate an old revision.

After shutdown, the wizard checks recovery again and asks separately before clearing the selected operational lock. Changed revisions, replicas, job executions, or Terraform state invalidate approval and require fresh review. All safety checks still apply. Hub can remain stopped if you decline clearing, cancel, or encounter a later failure; there is no automatic rollback. A failed or partially completed shutdown keeps the lock-clearing step blocked and reports that the current workload state needs review.

If another app, a running or unknown database job, locked Terraform state, unverified ownership, or a failed inspection also blocks recovery, automatic Hub shutdown is unavailable. Resolve or review those blockers separately. **Recheck safety before clearing the lock** performs fresh inspection but is not consent to stop workloads or bypass a blocker. **Exit and keep saved progress** preserves the reason in the restored shell. Failed or ambiguous Azure clearing responses remain unverified until the wizard reads the current lease state. Non-interactive deployment approval does not authorize lease recovery or this shutdown action.

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

## Protected GitHub Actions deployment

The [`Deploy Hub to Azure development`](../.github/workflows/hub-azure-deploy.yml) workflow updates one non-production installation through the protected `hub-azure-development` GitHub Environment. It runs only through **Run workflow**. The Environment approval gate is the deployment approval; pushes and pull requests never deploy.

The workflow builds the exact checked-out commit, pushes a commit-tagged image to the installation ACR, resolves its immutable digest, and passes that digest to the existing serialized release command. Deployment concurrency keeps one run active or queued and never cancels a release in progress.

### Prepare the installation

Use the guided installer for the first infrastructure bootstrap and one-time database-role provisioning. The workflow is an update and release path; it does not create the state backend, foundation, PostgreSQL administrator credential, or temporary provisioning identity. A first workflow release may create the Hub app after the installer has completed bootstrap and database provisioning.

Create the `hub-azure-development` GitHub Environment, require approval from the installation operators, and restrict deployment branches to the reviewed branch policy. Add an Entra application or user-assigned managed identity federated credential with:

| Federated credential field | Value |
| -------------------------- | ----- |
| Issuer | `https://token.actions.githubusercontent.com` |
| Audience | `api://AzureADTokenExchange` |
| Subject | `repo:github/replica:environment:hub-azure-development` |

Do not add an Azure client secret. The workflow requests `id-token: write` and [`azure/login`](https://github.com/Azure/login) exchanges the GitHub token for a short-lived Azure token.

### Configure the GitHub Environment

Store these non-secret values as Environment variables:

| Variable | Value |
| -------- | ----- |
| `AZURE_CLIENT_ID` | Client ID for the federated deployment identity. |
| `AZURE_TENANT_ID` | Entra tenant UUID. |
| `AZURE_SUBSCRIPTION_ID` | Installation subscription UUID. |
| `AZURE_LOCATION` | Existing installation region. |
| `AZURE_INSTALLATION_NAME` | Existing Terraform installation name. |
| `AZURE_INSTALLATION_OWNER` | Existing ownership tag value. |
| `AZURE_RESOURCE_GROUP` | Existing application resource group. |
| `AZURE_ACR_ID` | Full resource ID of the installation ACR. |
| `AZURE_KEY_VAULT_ID` | Full resource ID of the RBAC-enabled installation vault. |
| `AZURE_DEPLOYMENT_STORAGE_PRINCIPAL_ID` | Object ID of the deployment principal already recorded by Terraform for the installation storage grant. Preserve this value so a release does not replace that grant. |
| `AZURE_RUNTIME_DATABASE_SECRET_URL` | Versioned or unversioned Key Vault URL for the runtime database URL. |
| `AZURE_SETUP_DATABASE_SECRET_URL` | Different Key Vault URL for the migration database URL. |
| `AZURE_HUB_APPLICATION_ORIGIN` | Optional exact public HTTPS origin. Use the named input instead of the generic runtime map. |
| `AZURE_GITHUB_APP_ID` | Optional numeric GitHub App ID used for repository access and organization Copilot. |
| `AZURE_GITHUB_CLIENT_ID` | Optional GitHub App client ID used for sign-in. |
| `AZURE_GITHUB_APP_INSTALLATION_ID` | Optional numeric installation ID used for repository access. This is separate from the Copilot organization installation setting. |
| `AZURE_GITHUB_PROVIDER_REVISION` | Optional positive GitHub provider revision. Increment it when sign-in credentials or references change. |
| `AZURE_INSTALLATION_SETTINGS_JSON` | Required JSON object preserving `postgres_sku`, `postgres_version`, `backup_retention_days`, `custom_hostname`, and `certificate_id`. Use `null` for both custom-domain fields when no custom hostname is configured. |
| `AZURE_RUNTIME_ENVIRONMENT_JSON` | JSON object matching `runtime_environment_variables`; use `{}` when no additional non-secret runtime settings are configured. |
| `AZURE_RUNTIME_SECRET_REFERENCES_JSON` | JSON object matching `runtime_secret_references`; use `{}` when no additional runtime settings are configured. |
| `AZURE_STATE_RESOURCE_GROUP` | Terraform backend resource group. |
| `AZURE_STATE_STORAGE_ACCOUNT` | Terraform backend account. |
| `AZURE_STATE_CONTAINER` | Terraform backend container. |
| `AZURE_STATE_KEY` | Application module state key. |
| `NPM_REGISTRY` | Optional HTTPS npm proxy used only during the container build. |

Key Vault URLs are references, not secret values. Do not put secret values in GitHub variables, GitHub secrets, workflow inputs, repository files, or installation JSON. The workflow writes only references and non-secret coordinates to private temporary files and does not upload plans or configuration artifacts. Configure both runtime JSON variables explicitly; use `{}` only to deliberately remove every optional public setting or secret reference.

Copy the current private installation settings without changing their values. For example:

```json
{
  "postgres_sku": "B_Standard_B1ms",
  "postgres_version": "17",
  "backup_retention_days": 14,
  "custom_hostname": null,
  "certificate_id": null
}
```

Use the named Environment variables for Hub's public origin and GitHub App identity, client, repository installation, and provider revision. They follow the same validated Terraform inputs as the guided installer and cannot be duplicated in the generic runtime map.

Put other public runtime configuration in `AZURE_RUNTIME_ENVIRONMENT_JSON`. The workflow and Terraform accept only uppercase environment names of at most 41 characters, reject deployment-owned and credential-named settings, require string values, and reject names also used by secret references. Entra and organization Copilot examples include:

```json
{
  "HUB_TRUSTED_PROXY_HOPS": "1",
  "ENTRA_OIDC_ISSUER": "https://login.microsoftonline.com/TENANT/v2.0",
  "ENTRA_OIDC_CLIENT_ID": "entra-client-id",
  "ENTRA_OIDC_PROVIDER_REVISION": "1",
  "ENTRA_OIDC_CLIENT_AUTHENTICATION": "managed-identity",
  "ENTRA_OIDC_MANAGED_IDENTITY_CLIENT_ID": "managed-identity-client-id",
  "REPLICA_COPILOT_AUTHENTICATION": "github-app-installation",
  "REPLICA_COPILOT_GITHUB_ORGANIZATION": "organization",
  "REPLICA_COPILOT_GITHUB_INSTALLATION_ID": "12345678"
}
```

The installer creates `postgres-runtime-url` and `postgres-migration-url`. Store credentials under operator-chosen Key Vault secret names, then map their environment names in `AZURE_RUNTIME_SECRET_REFERENCES_JSON`:

```json
{
  "GITHUB_CLIENT_SECRET": {
    "key_vault_id": "/subscriptions/.../resourceGroups/.../providers/Microsoft.KeyVault/vaults/...",
    "secret_id": "https://YOUR-VAULT.vault.azure.net/secrets/github-client-secret/VERSION"
  },
  "HUB_AUTHENTICATION_ENCRYPTION_KEY": {
    "key_vault_id": "/subscriptions/.../resourceGroups/.../providers/Microsoft.KeyVault/vaults/...",
    "secret_id": "https://YOUR-VAULT.vault.azure.net/secrets/hub-authentication-encryption-key/VERSION"
  },
  "HUB_BOOTSTRAP_SECRET": {
    "key_vault_id": "/subscriptions/.../resourceGroups/.../providers/Microsoft.KeyVault/vaults/...",
    "secret_id": "https://YOUR-VAULT.vault.azure.net/secrets/hub-bootstrap-secret/VERSION"
  },
  "GITHUB_APP_PRIVATE_KEY_BASE64": {
    "key_vault_id": "/subscriptions/.../resourceGroups/.../providers/Microsoft.KeyVault/vaults/...",
    "secret_id": "https://YOUR-VAULT.vault.azure.net/secrets/github-app-private-key/VERSION"
  },
  "GITHUB_WEBHOOK_SECRET": {
    "key_vault_id": "/subscriptions/.../resourceGroups/.../providers/Microsoft.KeyVault/vaults/...",
    "secret_id": "https://YOUR-VAULT.vault.azure.net/secrets/github-webhook-secret/VERSION"
  }
}
```

Use `ENTRA_OIDC_CLIENT_SECRET` as a secret reference only when Entra uses `client-secret`; managed-identity mode keeps its client ID in the non-secret map. Increment authentication provider revisions before re-enabling a removed provider or intentionally invalidating in-flight attempts. Prefer versioned secret URLs so a credential change is explicit in the reviewed Terraform plan.

The guided GitHub App setup contract is now part of the base. Use the documented Key Vault secret names for client, private-key, webhook, encryption, and bootstrap values, or preserve equivalent existing references. The release identity manages only their URLs and secret-level role assignments; it does not read their values. The workflow cannot check `/api/settings/github/status` without a Hub administrator session, so authenticated setup-state verification remains a separate operator smoke test rather than a release-identity permission.

### Grant least-privilege Azure access

The deployment identity needs:

- `Storage Blob Data Contributor` on the Terraform state container.
- `Storage Blob Data Contributor` on the installation storage account for the release lease.
- `AcrPush` on the installation ACR.
- Resource read and update permission for the existing application resource group.
- Resource metadata read permission on the installation Key Vault. This does not grant secret-value access.
- Permission to create and remove role assignments at the application resource group, ACR, and each referenced Key Vault secret scope. Use a custom role when available; otherwise scope `Role Based Access Control Administrator` to only those resources.

Grant the workflow identity state, installation Blob, and ACR access before its first run; it needs those permissions before Terraform can initialize, acquire the release lease, or publish an image. Keep the installer's Terraform-managed installation storage grant unchanged. Read its non-secret principal with `terraform -chdir=infrastructure/azure state show 'azurerm_role_assignment.deployment_storage[0]'` against the protected application backend, then set `AZURE_DEPLOYMENT_STORAGE_PRINCIPAL_ID` to that `principal_id`. A mismatched value plans a replacement and the release guard stops before setup. Migrating or removing the original grant requires a separately reviewed access change outside the release.

The deployment identity does not need Key Vault secret data access. Terraform records secret URLs, creates secret-scoped `Key Vault Secrets User` assignments for the Hub or setup identity, and configures the Container Apps reference. Hub receives artifact storage and runtime-secret access. Setup receives only its migration URL and image pull. The temporary provisioning identity remains owned by the first-installation flow and is removed before release. Do not grant workload identities access to Terraform state, image publication, deployment control, or unrelated vault secrets.

### Deploy, recover, and verify

Select **Actions**, **Deploy Hub to Azure development**, **Run workflow**, then approve the `hub-azure-development` Environment deployment. The release command retains its infinite lease when setup, rollout, digest verification, readiness, health, or provider-configuration checks fail. Review the failed setup execution, active revision and image digest, and Terraform state before following the existing [interrupted-installation recovery](#interrupted-installation) procedure. Do not cancel a running deployment or break its lease.

The workflow verifies the exact active image digest, `/api/ready`, `/api/health`, and the unauthenticated `/api/auth/providers` configuration shape. It cannot prove a real GitHub or Entra sign-in, administrator enrollment, or a Copilot connection without a dedicated test identity and credential contract. Do not weaken authentication or reuse an operator credential for smoke testing.

## Manual reference

Operators can provision a durable Hub, run setup before every release, and replace the image without replacing its database or artifacts. This reference chooses Terraform with AzureRM to follow the team's Terraform experience; it is an implementation choice, not an application dependency. The main installation is flat under [`azure/`](azure/) rather than split into one-resource modules.

Definitions are grouped by responsibility: [`networking.tf`](azure/networking.tf), [`database.tf`](azure/database.tf), [`storage.tf`](azure/storage.tf), [`roles.tf`](azure/roles.tf), [`environment.tf`](azure/environment.tf), [`application.tf`](azure/application.tf), and [`setup.tf`](azure/setup.tf). Shared tags and the resource group remain in [`main.tf`](azure/main.tf). These files form one Terraform module; moving declarations between them does not change resource addresses or require state migration.

This installs the current Hub and, when configured, passes it the [GitHub App](#github-app) settings it uses for sign-in, reusable administrator enrollment, and repository access. It does not create the GitHub App, and hosted previews and review collaboration are not built yet. Supply the protected settings from [Hub deployment](../hub/docs/deployment.md#image-and-runtime), including the exact protected proxy-chain length, before enabling authentication. A public HTTPS endpoint does not authorize users or isolate prototype previews. Confirm product access requirements before exposing sensitive data.

## What is created

Each installation has its own resource group tagged with its application, installation name, owner, and Terraform ownership. It contains:

- A virtual network, delegated Container Apps and PostgreSQL subnets, and private PostgreSQL DNS.
- PostgreSQL Flexible Server, the `replica` database, enforced secure transport, and configurable point-in-time recovery retention.
- An Azure Storage account with private `artifacts` and `releases` containers, Blob versioning, and 14-day Blob and container soft deletion. Shared keys and anonymous access are disabled. The Blob endpoint is public-network reachable but requires Entra authorization; this is not a private-endpoint installation.
- Separate Hub and setup user-assigned identities. Only Hub receives `Storage Blob Data Contributor` on the artifacts container. Each identity can read only its referenced Key Vault secrets and, when configured, pull from an existing ACR. No vault or registry is created or owned.
- Log Analytics with 30-day retention, a Container Apps environment, a manual setup job, and, after successful setup, one combined Hub app.

Two optional modules have separate Terraform states and lifecycles. [`azure/foundation/`](azure/foundation/main.tf) creates an installation-owned ACR and RBAC-enabled Key Vault in a separate resource group, with `AcrPush` and `Key Vault Secrets Officer` grants for the deployment identity. The vault has 90-day soft deletion and purge protection. Pass its registry and vault outputs to the main installation; the main module still accepts existing resources and never owns their teardown.

[`azure/provision/`](azure/provision/main.tf) creates a temporary private-network database-role provisioning job and identity in the installation's Container Apps environment. It accepts the same immutable image and exactly three versioned Key Vault references: `DATABASE_URL` for the administrator, `HUB_MIGRATION_PASSWORD`, and `HUB_RUNTIME_PASSWORD`. Each secret URL must belong to the supplied `vault_id`. Its Azure startup entrypoint retrieves those values through the provisioning identity before importing database provisioning code. Omit `registry_id` for a public image; an existing ACR requires its resource ID and grants only the provisioning identity pull access. The job has one replica, no automatic retries, and a ten-minute timeout. An authorized operator must run it once against a fresh database, verify that exact execution succeeded, and remove the temporary job, identity, and grants before release. Do not rerun it against an installed database or grant its administrator secret to Hub or setup. The existing private-network operator script remains an alternative.

Initialize each optional module against its own protected backend state key, review its declared inputs and Terraform plan, and authorize its apply separately. Never share a state key with the main installation. Neither module starts Hub or replaces the serialized release command.

The app has external HTTPS ingress and minimum and maximum one replica **per revision**. Multiple-revision mode permits explicit deactivation before releases. Azure's single-revision mode deliberately overlaps old and new processes while readiness is checked, so it is unsuitable for this maintenance-window strategy. Do not activate old revisions alongside the combined worker. This is not a high-availability or zero-downtime installation.

The runtime receives `RUNTIME_MODE=combined`, `HOST=0.0.0.0`, `PORT=3001`, `CLIENT_DIRECTORY=/app/dist/client`, `SHUTDOWN_TIMEOUT_MS=30000`, and `NODE_ENV=production`. Artifacts use `ARTIFACT_STORAGE_PROVIDER=azure`, the provisioned `AZURE_STORAGE_ACCOUNT`, `AZURE_STORAGE_CONTAINER=artifacts`, and Hub's `AZURE_CLIENT_ID`. Optional `runtime_secret_references` map environment names to vault resource IDs and HTTPS secret URLs; at most 63 additional references are allowed because the runtime database URL is the 64th. Vault and secret names in these URLs must fit Azure's 24-character and 127-character limits. Terraform passes the Key Vault URLs, including the runtime database secret reference, as the non-secret JSON map `AZURE_KEY_VAULT_SECRET_REFERENCES`, never as inline secret values or Container Apps Key Vault secret bindings.

Use the optional `runtime_environment_variables` string map for non-secret Hub settings. Names must start with an uppercase letter and contain only uppercase letters, digits, or underscores, with at most 41 characters. Empty string values are allowed; null values are not. Deployment-owned names, including database credentials, storage settings, and startup identity/reference metadata, cannot be overridden. A name cannot appear in both this map and `runtime_secret_references`. These values go only to Hub, not setup or provisioning. The wizard adds no questions for this map; guided updates preserve it in the private workspace's `installation.tfvars.json`.

Optional `hub_application_origin`, `github_app_id`, `github_client_id`, `github_app_installation_id`, and `github_provider_revision` become their corresponding uppercase runtime variables only when set. Existing installations may instead supply these public settings through `runtime_environment_variables`; do not supply the same setting through both inputs.

For example, the manual Terraform module accepts:

```hcl
runtime_environment_variables = {
  HUB_APPLICATION_ORIGIN = "https://hub.example.com"
  GITHUB_CLIENT_ID       = "example-client-id"
}
```

These values are stored directly in Terraform state and Container Apps configuration. Do not put credentials, tokens, or private keys in this map; use `runtime_secret_references` for secret values. Terraform and guided updates reject names with an underscore-separated `SECRET`, `TOKEN`, `PASSWORD`, `PASSWD`, `PASSPHRASE`, `CREDENTIAL`, `APIKEY`, or `KEY` word, including plurals, such as `SERVICE_API_KEY` or `HUB_BOOTSTRAP_SECRET`. Supply those settings through `runtime_secret_references`, even when the value is not sensitive. Words that only contain these terms, such as `TOKENIZER` or `MONKEY_MODE`, are allowed. Supplying public authentication settings alone does not complete sign-in configuration; follow [Hub deployment](../hub/docs/deployment.md#image-and-runtime) for the corresponding required settings.

Terraform may include an invalid input line in its error output, including any credential supplied on that line. Remove credentials from the input before running Terraform and protect or redact any captured output if a credential was supplied.

Azure containers run `node dist/server/scripts/azure-entrypoint/index.js runtime`, `setup`, or `provision`. The entrypoint validates the complete reference map and explicit managed-identity client ID before fetching anything. It retrieves values directly from Key Vault with that identity, applies them to the workload's in-memory environment only after all reads succeed, then imports the selected workload. Startup secret retrieval has one 30-second deadline, with a bounded exponential retry for transient authorization, throttling, and service errors under the same identity; it stops on cancellation or failure before API/worker startup, database provisioning, or migrations. Secret-retrieval errors do not print token, URL, response-body, or secret contents. Registry pulling still uses Azure's normal managed-identity registry configuration; this does not bypass image-pull, DNS, or access failures.

Setup can receive only its migration `DATABASE_URL`; provisioning requires exactly its three versioned administrator/password references. Runtime requires its runtime `DATABASE_URL` and may receive validated additional references. References cannot overwrite already-defined environment values or deployment-owned configuration, including the identity and reference-map fields. Existing secret-scoped grants remain unchanged; no vault-wide access is added. Versioned URLs are recommended for deliberate rotation. An unversioned runtime/setup URL selects the latest value only at startup, not through Container Apps' background secret refresh. Restart through a reviewed serialized release to pick up a new version.

Terraform ignores only Azure-assigned PostgreSQL availability-zone and Container Apps infrastructure-resource-group values. It still checks other drift and owns both images. The installation output exposes authoritative app, resource-group, and storage-account IDs; before the first release, the app ID is `null`.

The setup job uses the same digest and command `node dist/server/scripts/azure-entrypoint/index.js setup`. Its environment settings are `NODE_ENV=production`, `RUNTIME_MODE=setup`, `DATABASE_RUNTIME_ROLE=replica_runtime`, its own `AZURE_CLIENT_ID`, and a reference map containing only its migration `DATABASE_URL` for `replica_migration`. It receives no artifact configuration or additional runtime secrets. It has one replica, no automatic retries, and a 30-minute timeout. Hub's readiness probe is `/api/ready`; startup and liveness use `/api/health`. Azure allows 60 seconds for termination, covering the 30-second application drain and up to five seconds of telemetry flushing with platform margin.

Neither workload receives the PostgreSQL administrator credential. A separate, one-time operator script provisions the migration and runtime roles over the private database network. Setup owns schema changes and refreshes the runtime's data permissions after migrations. See [database access](../hub/docs/database.md#deployment-database-roles). Managed identity is used for Blob, Key Vault, and ACR, not database authentication.

## Prepare access and protected state

Use the Terraform version constrained in [`versions.tf`](azure/versions.tf), a Node.js version supported by `scripts/package.json`, and a current Azure CLI with Container Apps job and revision commands. CI performs formatting, validation, mocked Terraform tests, and release-orchestration tests without cloud credentials. It does not deploy.

An authorized administrator must first create the **separate** Terraform backend: a dedicated state resource group, Storage account, and private container. Enable TLS, Entra authorization, Blob versioning and soft deletion; disable shared-key authorization and anonymous Blob access, and grant the deployment identity `Storage Blob Data Contributor` on the state container. Apply any network restrictions required by deployment policy and ensure the runner can reach the account. These bootstrap resources are not part of this installation's state or teardown. Never store this state in the app's artifacts account.

For automation, configure a dedicated deployment identity with a federated workload identity credential rather than a client secret. The protected non-production workflow is described in [Protected GitHub Actions deployment](#protected-github-actions-deployment). The infrastructure-check workflow intentionally has no Azure permission.

Set `ARM_CLIENT_ID`, `ARM_TENANT_ID`, `ARM_SUBSCRIPTION_ID`, and `ARM_USE_OIDC=true` in that authorized runner. Terraform's AzureRM backend supports GitHub's OIDC request environment; other runners must supply their supported OIDC token source. For local authorized operation, use Azure CLI sign-in and set `use_oidc=false` in your private backend configuration instead. Do not copy tokens into Terraform inputs.

The deployment identity needs resource creation/update rights for the installation, role-assignment rights for the artifact container, referenced Key Vault secrets and optional registry, and Blob data-plane rights on the installation's account for the lock blob. Resource `Contributor` alone does not grant data access or role assignment. An administrator must authorize initial resource-group creation and inherited Blob data access for bootstrap, then narrow ongoing deployment grants to the installation resource group, referenced secrets, existing registry, and backend container. Precreated/imported infrastructure needs a separately reviewed initial plan rather than the empty-state bootstrap command. Do not grant either workload identity deployment or state access.

The main module's optional `grant_deployment_storage_access=true` grants the authenticated Terraform deployment identity `Storage Blob Data Contributor` on the installation account. It defaults to `false`; use it only when this account-level grant matches the deployment policy. It does not grant access to the separate state backend.

Register `Microsoft.App`, `Microsoft.OperationalInsights`, `Microsoft.Network`, `Microsoft.Storage`, `Microsoft.DBforPostgreSQL`, and `Microsoft.ManagedIdentity` beforehand. Before applying the optional foundation module, also register `Microsoft.ContainerRegistry` and `Microsoft.KeyVault`. The providers do not register services across the subscription. Allow time for newly assigned RBAC roles to propagate before setup.

Copy [`backend.hcl.example`](azure/backend.hcl.example) to `infrastructure/azure/backend.hcl` and [`installation.tfvars.example`](azure/installation.tfvars.example) to `infrastructure/azure/installation.tfvars`. Both real files are ignored. Replace every placeholder, choose a globally unique name, and resolve an existing image to its real `registry/repository@sha256:...` digest. Use either a public image or an existing ACR; private non-ACR registry credentials and ACR's ABAC repository-permissions mode are not covered by this reference.

Prepare an existing RBAC-enabled Key Vault reachable by the Container Apps environment. Supply `runtime_database_secret` and `setup_database_secret`, each with the vault's resource ID and a distinct HTTPS secret URL. Before bootstrap, store separate database URLs for `replica_runtime` and `replica_migration` with independently generated passwords, the planned private PostgreSQL hostname, database `replica`, and `sslmode=verify-full`. Percent-encode URL credentials. The identities receive secret-scoped `Key Vault Secrets User` grants, so sharing a vault does not give setup access to runtime secrets. Additional runtime references must not point at the migration credential. The vault, secret values, rotation and retention remain operator-owned; Terraform never reads those values. Prefer versioned URLs for deliberate rotation through a serialized release.

Supply `postgres_admin_password` from a secret manager as `TF_VAR_postgres_admin_password`, or through the ignored variables file with mode `0600`, for bootstrap only. This provisioning password still enters Terraform state; replacing application secret values with references does not remove it or erase historical secret values in older state versions. The serialized release path reuses the existing password without receiving its value and Terraform ignores password changes after creation. Rotate the administrator password only through a separately designed recovery procedure. Never enable shell tracing while injecting secrets. Terraform's sensitive marking redacts normal CLI output but **does not encrypt state or saved plans**. Protect backend access, runner logs, environment variables, and local `.terraform/`; never publish a JSON plan or upload it as a CI artifact.

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
6. Only after success, plans/applies the complete configuration with `deploy_hub=true` and the same image digest. It checks the latest revision's activation state and activates it only if inactive. It then waits for Azure's ready-revision signal and an HTTPS `/api/ready` response before releasing the lease.

Terraform owns the image in both resources. Neither resource uses `ignore_changes` for the image, and the orchestrator never uses out-of-band `az containerapp update --image`. A later infrastructure apply cannot silently use a stale image. Provisioning and rollout are separated by the two phases above. Never run a full Terraform apply directly on an installed Hub, start a setup job manually, or change revisions in the portal outside this serialized procedure. Terraform state locking alone does not protect setup-to-rollout ordering. The app's `prevent_destroy` guard rejects accidental `deploy_hub=false` on later full plans.

Azure can activate the revision during Terraform rollout. Requesting activation again can return `RevisionAlreadyInRequestedState`; the release script checks that exact revision rather than treating an already-active revision as a failed release. Unknown or mismatched activation state still blocks completion. An active revision alone is not success: readiness checks must pass before the lease is released.

Successful Azure operations that return no data, such as lease release, are checked by exit status rather than parsed as JSON. Responses used for deployment decisions still require valid JSON. Invalid replies name the operation without disclosing tool output.

Plans reject resource deletion and replacement during normal releases. A database major upgrade, region move, rename, or replacement needs a reviewed migration/recovery plan, not an override of that guard. The release script stores sensitive plans under `TF_DATA_DIR` when nonempty, otherwise under the module's `.terraform/`, and deletes them on exit. Relative `TF_DATA_DIR` paths resolve against `infrastructure/azure/`, matching Terraform's `-chdir` behavior; protect that directory if it is outside the module. Failures identify a fixed command label and available exit code without printing arguments or tool output. It retains an acquired lease on failure. A failure after stopping old revisions but before rollout leaves Hub stopped; a failure after rollout can leave the new revision running. The script never reactivates an older process automatically against a possibly migrated schema.

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

## Post-setup configuration

From the repository root, run `npm run setup:post`. It uses the same terminal interface as installation, but offers only **Configure sign-in and setup access**, **Configure GitHub App**, **Restart Hub**, and **Exit**. Choose an existing saved installation or enter its config-file path with `--config FILE` (relative to `infrastructure/` through the root shortcut). An unfinished setup draft must be resolved first. Exit performs no local writes or Azure calls.

Post-setup reuses the active deployment's exact immutable image. It never builds/publishes an image, bootstraps infrastructure, provisions database roles, runs setup/migrations, or starts the full maintenance release. It verifies the saved target, resource-group ownership and selected jobs, and coordinates with the existing local writer/workspace and installation/release leases. It does not scan other installations or the subscription. Confirm all other deployment processes have stopped; unknown or foreign retained leases block it rather than being broken.

**Configure sign-in and setup access** defaults to Azure's authoritative app origin, or retains an existing configured origin. A custom origin must already be bound to the app and use the standard HTTPS port. Changing the origin while Entra settings exist is blocked: coordinate the Entra callback and provider revision separately. An origin change with GitHub configured also requires the stored GitHub revision described below and explicit permission to enable GitHub sign-in, even if the provider is currently disabled. Declining preserves desired inputs and secret versions. Enter the actual protected proxy hop count; the tool does not guess. A secret-backed hop count must be reviewed separately rather than overwritten with a plain value. Existing shared keys are preserved and validated. An unversioned shared key or secret-backed origin is pinned to the exact version read and validated. When absent, it reuses valid secrets with the documented names in the installation's protected Key Vault, or privately generates and stores them. A newly generated bootstrap secret is saved in a named private workspace file for the operator to escrow; its value is not printed. Keep that file until the secret is recoverably stored in your secret manager. An ordinary rerun never rotates existing shared keys.

If saved authentication settings lack an origin, configure sign-in to repair them. The updated inputs must pass normal validation before Terraform runs. GitHub App configuration and restart remain blocked until the origin is repaired.

**Configure GitHub App** requires the shared setup context first. Open the reported `/settings/github/setup` guide to create or explicitly reuse an App in GitHub and install it on approved repositories. The tool shows the exact callback, setup and webhook URLs, collects the public identifiers/provider revision, and accepts credentials through private file paths only. Client secret/webhook files and the RSA PEM must be current-user-owned 0600 files inside a private 0700 directory. Do not paste credentials into path prompts. The webhook value must match GitHub. Blank paths retain existing credentials, pinning unversioned references to the exact version read and validated; supplying a file creates a new version under the existing secret name. Rotations in another vault or of an unsupported reference require separate review. Public IDs remain plain inputs, and secret values never enter Terraform inputs or telemetry. A reused App has one webhook destination; changing it can affect another Hub.

When replacing the App while Copilot uses `github-app-installation`, independently verify that `REPLICA_COPILOT_GITHUB_INSTALLATION_ID` belongs to the replacement App and `REPLICA_COPILOT_GITHUB_ORGANIZATION`. Copilot shares the App ID and key, but its organization installation can differ from the repository installation. Post-setup requires fresh confirmation, including on resume, before continuing. Declining preserves desired inputs and secret versions so you can review the Copilot settings separately. Unchanged Apps and other Copilot authentication modes need no confirmation; Copilot settings and secret references are never replaced automatically.

Before configuring GitHub, independently verify its stored provider revision and enabled state through an authorized database connection from a host that can reach the private database network. Keep connection credentials out of commands and diagnostics. The deployed environment revision may not have reconciled, and disabling a provider does not erase its last revision. The following read-only transaction uses the same selected-or-latest ordering as Hub:

```sql
BEGIN TRANSACTION READ ONLY;
SELECT provider.enabled, revision.revision, revision.configuration_digest
FROM authentication_providers AS provider
LEFT JOIN LATERAL (
  SELECT candidate.revision, candidate.configuration_digest
  FROM authentication_provider_revisions AS candidate
  WHERE candidate.provider_id = provider.id
  ORDER BY (candidate.id = provider.selected_revision_id) DESC, candidate.revision DESC
  LIMIT 1
) AS revision ON true
WHERE provider.key = 'github';
COMMIT;
```

Enter `0` only when the query returns no provider row; a row without a revision requires separate repair. For an unchanged provider, compare the stored digest and enabled state with the fingerprint shown in the wizard before keeping its revision. Otherwise use the next consecutive stored revision. Recheck the database on every resume: a partially completed rollout may already have advanced it. Post-setup does not query or change the database directly.

Invalid answers stay at their prompt instead of ending post-setup. Earlier accepted answers are saved as they are entered. A credential-file error explains whether its path, ownership, permissions, size or format needs correction. Choose **Recheck the same file or pinned secret** after repairing it outside the Wizard, **Edit the file path**, or **Exit and keep saved progress**. Paths accept surrounding whitespace/matching quotes, `~/`, and drag-and-drop escaped spaces; internal spaces are preserved. Post-setup never runs shell expansions or changes file ownership/permissions.

Private `post-sign-in-progress.json` and `post-github-progress.json` files inside the installation workspace retain validated public answers, validated absolute credential paths and confirmed versioned Key Vault references. They are atomically saved with 0600 permissions and bound to the exact installation, action and saved inputs. No credential text, PEM contents, tokens, rejected input or approval is stored. On relaunch, **Resume saved answers** skips completed prompts after revalidation, except for the stored provider revision, enabled-state verification and any required Copilot installation reconfirmation. Not-yet-uploaded credential files are read and validated again; successfully uploaded credentials are checked through their pinned Key Vault references and do not require the old local file. **Start over with the answers** requires confirmation and clears only prompt answers, never stored secrets, desired inputs or cloud resources. Each successful secret write is checkpointed before the next write. If a write's outcome is unknown, post-setup checks the current stored value first; creating another version requires an explicit choice. Resolve the pending credential before uploading a different one; provide its private file again if needed.

If sign-in setup stops after saving desired inputs but before completing its progress file, it can resume with an unchanged secret-backed origin. New progress files retain reference-only evidence to check that transition, including pinning an unversioned origin or shared authentication reference without changing an existing pinned version. They also bind normalization of the image and `deploy_hub` to the verified deployment image. Unrelated input or reference changes still stop resume and preserve the files for review. Older progress files without the relevant evidence still require review when their input fingerprint changes.

Configuration actions disclose secret writes and downtime, then save desired inputs and a private previous-input backup before applying. They correct an obsolete saved `deploy_hub=false` from bootstrap, retain unrelated runtime settings, and use the exact deployed image instead of the saved build candidate. Unrelated saved and live settings or secret references that disagree block configuration before secret writes or input persistence; reconcile them separately instead of overwriting either side. Each fresh Terraform plan is shown for approval. Only an in-place Hub runtime-environment update and intended secret-scoped `Key Vault Secrets User` grants are allowed; infrastructure drift, replacements, deletions, and image changes block the action. Every plan and replan that creates a role grant must first check Azure. A detected assignment missing from Terraform state, an unsuccessful lookup, or an incomplete, malformed, or ambiguous response blocks that plan before approval, apply, or Hub shutdown; review the reported recovery rather than deleting or automatically adopting a grant. Desired inputs or secret versions saved before planning remain available for recovery. Old Hub replicas are stopped only for an actual app update, before Azure creates the new configured revision. A grant-only or no-change plan does not stop Hub.

Readiness and protected setup availability are checked afterward; GitHub configuration also checks that GitHub appears in the provider API. Setup-only mode can legitimately leave the provider API unavailable. These checks do not prove GitHub client-secret correctness, OAuth callback registration, repository permissions or signed webhook delivery: complete the browser connection test and administrator enrollment separately.

**Restart Hub** restarts only the one active revision serving all traffic. It does not activate an old or stopped revision, apply Terraform, change settings, or fetch newer secret versions. Every live runtime Key Vault reference, including `DATABASE_URL`, must already be version-pinned; unversioned references block restart. Multiple active revisions, split traffic or an unverified image also stop the action. To load new pinned references, use a configuration action instead.

On failure, desired inputs, a `post-desired.json` progress marker and owned lease evidence are retained. Rerun the same configuration action to prepare a fresh checked plan; shared secrets already created are reused. A pending marker whose hash does not match the saved inputs blocks the rerun, including after interruption between the marker and input writes. Preserve the marker, inputs, backups and progress files; after prior processes have stopped, review them together with the live deployment, secret-write outcomes, Terraform state and leases before a separately reviewed manual recovery. Terraform failures may leave partial state or untracked successful grants, so inspect ambiguous outcomes before retrying and reconcile an exact missing state mapping separately. A stopped Hub can retry a configuration change that creates a new revision; a stopped app with no proposed runtime change requires rollout review, not automatic old-revision activation. Verification offers a recheck-only action that never replays configuration or restart. New secret versions may have been created before a later step failed. No automatic rollback or lock breaking is performed.

Exiting during input collection, before any secret or desired-input write and without earlier partial-write evidence, succeeds, releases only this run's owned leases and keeps its prompt progress. Once those writes may have started, exit reports failure and retains partial-operation evidence and owned leases for the same action's recovery. A changed installation, action, desired-input fingerprint or conflicting progress file blocks reuse rather than overwriting either version.

Post-setup cannot upgrade an image or migrate a database. Use the normal installation Update flow for a code release. Keep private desired-input/backups and generated bootstrap files out of version control and shared diagnostics.

## GitHub App

The setup page needs the public HTTPS origin, database, and shared authentication secrets before GitHub is configured. Use `npm run setup:post` and **Configure sign-in and setup access** after installation. The public origin is read from the deployed app, not guessed from its resource name. For manual configuration, set `hub_application_origin` to the exact public origin without a trailing slash. Existing installations may retain a `HUB_APPLICATION_ORIGIN` Key Vault reference instead of the plain variable; do not set both.

Post-setup preserves or privately creates the shared secrets and their versioned references. For the manual path, use the commands in [`installation.tfvars.example`](azure/installation.tfvars.example). Preserve existing shared secrets when updating a Hub. After configuration, open `/settings/github/setup` and use the bootstrap secret until the first administrator has enrolled; afterward, setup requires an administrator session. Hub never accepts App credentials through this browser page: store them through the post-setup menu or your authorized Key Vault process.

Create the GitHub App in GitHub through your authorized process, or reuse an existing App by adding this Hub's callback URL to it. `/settings/github/setup` lists every URL and value with copy buttons. Use `https://YOUR_HUB_HOST/api/auth/github/callback` as its callback URL and `https://YOUR_HUB_HOST/api/github/webhooks` as its webhook URL, then install it on the intended account. Terraform passes the App ID, client ID, installation ID, and provider revision as plain environment variables. Credentials are never Terraform values.

Store these secrets in an existing RBAC-enabled Key Vault and map them through `runtime_secret_references`:

| Environment variable                | Key Vault secret                    | Contents                                                         |
| ----------------------------------- | ----------------------------------- | ---------------------------------------------------------------- |
| `GITHUB_CLIENT_SECRET`              | `github-client-secret`              | The App's client secret.                                         |
| `GITHUB_APP_PRIVATE_KEY_BASE64`     | `github-app-private-key`            | The single-line base64 encoding of the App's `.pem` private key. |
| `GITHUB_WEBHOOK_SECRET`             | `github-webhook-secret`             | The App's webhook secret.                                        |
| `HUB_AUTHENTICATION_ENCRYPTION_KEY` | `hub-authentication-encryption-key` | Hub's authentication encryption key.                             |
| `HUB_BOOTSTRAP_SECRET`              | `hub-bootstrap-secret`              | Hub's bootstrap secret.                                          |

[`installation.tfvars.example`](azure/installation.tfvars.example) shows the variables, references, and `az keyvault secret set` commands. Use `--file` rather than `--value` so secrets do not appear in process lists or shell history, and `--query id --output tsv` so the commands print only the versioned IDs, not secret values. Work in a new private directory to avoid overwriting files and delete local copies afterward. Keep these secrets out of `runtime_environment_variables`; the plain GitHub identifiers and revision cannot be supplied as references. Terraform also requires the client ID when the client secret or private key is referenced, and the App ID and installation ID when the private key is referenced. A Copilot-only App, with `REPLICA_COPILOT_AUTHENTICATION=github-app-installation` and no sign-in, installation, or webhook settings, needs only the App ID. Supply each public setting through its named variable or the non-secret environment map, not both.

The vault must have soft delete and purge protection enabled so a deleted credential can be recovered. Limit secret writes to administrators. Hub's identity receives only `Key Vault Secrets User` on each referenced secret, not on the vault, and the setup job receives none of them.

Prefer versioned secret URLs. The Azure startup entrypoint retrieves the selected version once before starting Hub. Versionless URLs select the latest value at that startup; they do not enable background refresh or automatic revision restarts. Load changed references through a serialized release.

To rotate a GitHub App credential:

1. Add a new client secret or private key in the GitHub App settings. Keep the old one.
2. Store the new value as a new version of the Key Vault secret.
3. Update the versioned reference in `installation.tfvars` and increase `github_provider_revision`.
4. Run the release command, which applies Terraform.
5. Test the App on `/settings/github/setup` and sign in with GitHub. The connection test cannot verify the client secret or callback URL.
6. Delete the old credential in GitHub.

## Backups, restore, and migration

PostgreSQL retains point-in-time backups for `backup_retention_days` (default 14). Blob/container soft deletion retains deleted objects for 14 days; versioning preserves earlier content, but versions incur storage charges and are not an independent backup. These defaults provide neither regional disaster recovery nor high availability. Managed PostgreSQL, the app's minimum replica, private networking, logs, backups, and Blob versions have ongoing costs even when traffic is low.

Agree on acceptable data loss and recovery time with the installation owner. Schedule independent database exports and artifact copies to a separately authorized backup destination with its own retention. Run database exports from an authorized private-network host or job; PostgreSQL has no public firewall exception. Encrypt exports and never place credentials in commands, logs, or committed files.

For recovery, stop releases and Hub, record the database recovery point and matching artifact manifest, and restore PostgreSQL to a **new** server using Azure point-in-time recovery. Restore Blob versions or independent copies to a separate private container/account. Verify database records, queue state, and artifact references together. A database restore alone cannot restore matching artifact state.

Reconcile the restored resources with a reviewed Terraform configuration and import/state-migration plan before deployment; a restored server has different identifiers and this normal release script intentionally rejects replacements. Do not overwrite or delete the original resources until the restored installation has passed setup, integrity checks, HTTPS/readiness, representative authenticated operations, and a measured recovery exercise. Document the observed recovery time and data loss.

To move an existing installation, pause writes and workers, export PostgreSQL, copy artifacts with an object manifest, import both into the new installation, and verify counts/checksums and a representative operation before switching traffic. Keep source backups and a rollback window. No automatic migration between local and Azure installations is performed here.

## Optional Azure decision runtime

Set `enable_decision_runtime = true` only after the customer has selected an Azure region with Container Apps serverless GPU support, obtained quota, and provisioned a manual scale-to-zero GPU Job plus a fixed-template control broker. Supply the job's resource ID, name, and managed identity object ID; the broker's HTTPS URL, resource ID, and custom invocation role; and the customer inference endpoint resource ID and custom inference-only role. The normal Hub PostgreSQL database stores decision job, lease, cancellation, idempotency, and promotion state; no second database is created.

The optional path adds:

- a private `decision-runtime` container in the existing keyless, versioned storage account;
- separate runtime and inference user-assigned identities, plus the supplied training job identity;
- coordinates for one customer-provisioned manual Container Apps Job on a T4 or A100 consumption GPU profile whose minimum count is zero;
- customer-defined, container-scoped Blob roles that allow runtime and training reads and writes but no deletion, a broker-invocation grant for runtime, and the customer-supplied endpoint role for inference.

The pinned AzureRM provider does not yet accept Azure's serverless GPU workload profile types, so this module does not claim to provision the GPU job. Create it separately with a reviewed Azure deployment using a manual trigger, one execution replica, no automatic retry, a hard execution timeout, and zero idle GPU capacity. Put a broker in front of the job that accepts only the bounded Replica payload and starts or cancels that fixed template. The broker must reject image, command, environment, identity, registry, secret, and resource overrides. Do not grant Hub Container Apps Jobs Operator. Configure the connector's required cancellation-recovery hook to durably enqueue the execution ID before each direct cancellation attempt; a customer worker retries that cleanup after cancellation, deadline, or status loss cannot reach Azure. The job's immutable training image owns the model and GPU implementation. It must accept the connector's operation, scope, taskset, deadline, `maxUpdates`, `maxCredits`, and budget mode payload; write immutable adapter and report artifacts; stop before the deadline or hard credit limit; and return measured usage and cost when Azure supplies them.

The storage account keeps normal 14-day soft-delete recovery and permits an authorized workflow to permanently delete soft-deleted versions. A decision-container lifecycle rule removes superseded versions after `decision_artifact_version_retention_days`, default 30. Supply custom runtime and training storage roles that permit only the required Blob read, create, and write actions and explicitly omit delete and permanent-delete actions. Use a separate short-lived withdrawal identity to recheck the affected export, permanently delete the current taskset or candidate Blobs and every version, and write the result to the customer's audit system.

The inference role is intentionally not created here because its exact actions depend on the customer endpoint service. Define a custom role with only readiness and prediction actions, assign its ID through `decision_inference_role_definition_id`, and verify it cannot create, update, deploy, train, list credentials, or change endpoint access. The inference connector checks the expected promotion generation before every prediction and reports cold start separately.

Exact authorized cloud walkthrough still required before production:

1. Confirm the selected region advertises the chosen `Consumption-GPU-*` profile and grant enough GPU quota for the intended maximum concurrent jobs.
2. Build the reviewed training worker, pin its ACR image digest, and prove its result schema, cancellation, deadline, and hard-credit behavior against a non-production taskset.
3. Provision the manual Container Apps GPU Job with minimum GPU capacity zero, one execution replica, no automatic retry, and a hard timeout. Record its resource ID, name, and managed identity object ID.
4. Deploy the fixed-template broker, create an invocation-only role, and prove that its caller cannot read job secrets or override the image, command, environment, identity, registry, or resources.
5. Apply this Terraform module with the job, broker, and custom non-delete storage roles. Confirm the Blob container has no public or shared-key access, runtime and training cannot delete a Blob or version, and each identity has only the documented grants.
6. Run `initialize_azure_postgres` through the existing migration role, then exercise create, retry, lease expiry, cancellation, candidate persistence, promotion conflict, rollback, restart recovery, and consent-withdrawal deletion.
7. Upload a private taskset through managed identity, train one bounded candidate, and compare the job's reported usage and cost with Azure Monitor and Cost Management.
8. Deploy or select the customer inference endpoint, apply the custom invocation-only role, measure cold-start readiness, and prove a stale expected generation cannot score.
9. Exercise the dedicated withdrawal workflow and verify that the current taskset or candidate Blob, its soft-deleted copy, and every prior version are permanently unavailable while unrelated data remains.
10. Inspect Log Analytics and the configured OpenTelemetry/Pino sink to confirm signals contain operation IDs, bounded usage, cost, status, and hashed scope only—never screenshots, prompts, learnings, artifacts, tokens, or credential material.
11. Test retention, Blob version recovery, PostgreSQL point-in-time restore, identity revocation, endpoint outage, GPU quota exhaustion, and owned-resource teardown.

Local Terraform and mocked connector tests do not perform this walkthrough and do not claim a live Azure deployment.

## Installation removal

Replica's setup wizard and deployment script do not remove installations. Earlier installer versions could leave private `<config path>.removal.json` files beside configurations. The wizard ignores these files and leaves them unchanged; they may contain installation details, so keep them private or delete them yourself after review.

## Credential-free checks and evidence limits

From `infrastructure/azure/`, check the main installation:

```sh
terraform init -backend=false -input=false -lockfile=readonly
terraform fmt -check -recursive
terraform validate
terraform test
node --test tests/diagnostics.test.mjs
node --test deploy-hub/index.test.ts stop-hub/index.test.ts ../installer/command/describe/index.test.ts
```

Run the same Terraform initialization, formatting, validation, and test commands from `foundation/` and `provision/` to check the optional modules. CI checks each module using both supported Terraform versions in [the workflow matrix](../.github/workflows/hub-infrastructure.yml).

Terraform tests use AzureRM mocks, not an Azure subscription. Orchestration tests replace command execution and HTTPS requests, proving ordering and failure gates rather than Azure behavior. Readiness includes a bounded, non-writing container-properties request through Hub's managed identity; it detects unavailable storage but does not prove write or delete authorization. Worker readiness remains initialization-only. Before production, an authorized tenant exercise must verify provisioning, private PostgreSQL connectivity and TLS, separate database roles, Key Vault resolution, identity-based Blob/ACR access after RBAC propagation, failed setup blocking rollout, maintenance shutdown and revision behavior, HTTPS/readiness, persistence across replacement, custom TLS when configured, backup restoration, and owned-resource teardown. No real-cloud result is implied by these local checks.

The release command and its tests are TypeScript running directly in Node.js. Terraform's own tests use `.tftest.hcl`; neither requires Python. From the repository root, `npm run typecheck --prefix scripts` checks the TypeScript operational scripts as well.

# Azure Hub installation

## Guided installation

Interactive setup starts with **Create a new installation**, **Update existing installation**, **Remove deployments (destructive)**, **Resume in progress setup** when a compatible unfinished draft is known, and **Exit and do nothing**. The menu uses read-only local discovery before creating diagnostics, drafts, directories, or writer locks, and before running Azure or prerequisite commands. Exit restores your terminal without changing local files or Azure resources.

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

The guided flow creates a tagged state resource group/account first, with shared-key authorization and anonymous blob access disabled, TLS, identity-based data access, versioning, and soft deletion. Its public network endpoint accepts requests from any network, but reading or changing state still requires Azure authentication and Blob data permissions. The wizard does not require an IP address, CIDR, or external IP lookup. These bootstrap resources remain outside application Terraform state and are never deleted by the normal application destroy command. Do not reuse this backend for unrelated installations.

If an earlier installer created an IP-restricted state account, the wizard verifies its ownership and authentication settings, then asks interactively before switching to authenticated access without the network restriction. Unattended runs refuse this change; `--approve-deployment` is not consent to remove network restrictions. It verifies the resulting settings before using state storage. It will not override disabled public access, a network perimeter, or an account with different ownership or unsafe authentication settings. If your organization requires private networking, use an authorized deployment path rather than bypassing that policy.

It then uses separate protected Terraform state files for the foundation, application, and temporary provisioning modules. Foundation resources include an ACR and an RBAC-enabled, purge-protected Key Vault. Passwords are generated independently and written to Key Vault using private temporary files, never command-line values. Existing credentials are reused, not silently rotated. The PostgreSQL administrator password still enters protected application Terraform state.

The wizard builds and pushes a Linux AMD64 image and deploys its immutable digest. On first installation, Hub remains absent while a separate private-network job initializes the database roles. This job has its own temporary managed identity and secret-scoped administrator/password access; neither Hub nor normal setup receives administrator access. After success, the wizard records completion in Key Vault and destroys the temporary job, identity, and grants before invoking the existing serialized release procedure.

The final release stops old revisions, runs migrations and schedule setup, starts Hub, and checks HTTPS readiness. Readiness is not authorization. Hub supports optional, manually configured GitHub sign-in and administrator enrollment; the wizard does not configure them. Supply the protected authentication settings from [Hub deployment](../hub/docs/deployment.md#image-and-runtime) before enabling sign-in. Artifact import, hosted previews, and reviews are not available yet.

### Saved configuration and repeat runs

Create saves non-secret choices in a uniquely named ignored `infrastructure/.local/installation-UUID.json`. If `--config FILE` names an unused configuration/draft path, Create uses it; if that path is occupied, Create uses a new uniquely named file beside it. Exclusive first saves refuse a file that appears after selection rather than overwriting it. Previous configurations, drafts, and local writer records are kept. Creating a new configuration does not authorize adopting or overwriting Azure resources; normal collision and ownership guards still apply.

Update, Resume, and removal discover JSON configurations and companion drafts directly under `infrastructure/.local/`, including older `installation.json` files. Use the config-file path option for files stored elsewhere; `--config FILE` adds that path to the picker. If Update discovers an unfinished draft at an explicit path, it returns to the entry menu with Resume available. Update does not discard or consume an unfinished draft: resume it instead. Repair an invalid or conflicting file, or preserve and move it out of the selected path after reviewing it, before reusing that path. Create can start independently without changing any of those files.

Private generated inputs and Terraform working directories live beside the configuration in `INSTALLATION_NAME-TARGET_HASH/`. The hash identifies the cloud, normalized tenant and subscription IDs, installation name, region, and case-normalized app resource group. Interactive and unattended runs use the same path. Separate targets cannot share generated files; adjacent configurations for the same target share a local workspace writer lock in addition to the Azure leases.

Keep the configuration directory private and owned by the current user (0700). Existing generated files must be private regular files (0600), not symlinks or hard links. Setup refuses shared, untrusted, or redirected paths without changing their permissions or contents. Start from [`installation.example.json`](installation.example.json) if you prefer to fill out the JSON yourself. Real configuration files belong under the ignored `.local/` directory, not beside the tracked example. The root shortcut runs the wizard from `infrastructure/`, so relative `--config` paths are resolved from that directory.

An existing name-only workspace such as `.local/INSTALLATION_NAME/` blocks deployment before cloud changes. Do not delete it or start with empty state. After stopping prior local installer processes, independently verify the saved subscription, tenant, installation, owner, and backend state keys against the intended configuration. Preserve a private backup and move that verified workspace to the target-specific path printed by setup. Review its private inputs and Terraform backend before rerunning. A mismatch or ambiguous workspace needs manual recovery rather than automatic adoption. This local migration does not clear any cloud leases.

Updates preserve validated optional inputs already stored in the workspace's `installation.tfvars.json`: `runtime_secret_references`, PostgreSQL SKU and major version, backup retention, and the custom hostname/certificate pair. Runtime references must match the main module's environment-name and Key Vault rules and must not reference the migration credential. Other customizations or invalid inputs stop setup before cloud changes or input rewrites. Review changes to immutable infrastructure through the existing Terraform guards; retaining a setting is not approval to replace resources.

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

Failed commands report a safe operation label and exit status by default, including in unattended output. Raw stderr is held privately in memory, limited to 64 KiB with terminal-control sequences removed. It is shown only after an interactive **Show full error details** choice in a supported recovery menu. Those details may be sensitive: review them locally before sharing terminal captures. When setup exits after a failed command, it also prints the last 20 lines (at most 4,000 characters) of those details below the error; the diagnostics log does not include them. Known read-only Azure and Terraform checks, such as listing or showing resources and reading Terraform state or outputs, retry up to twice after recognized transient network or service errors (timeouts, connection resets, throttling, or 5xx responses), waiting 2 and then 5 seconds. Commands that can change resources, cancelled commands, and other errors are never retried automatically. Successful command output is returned only to the caller, including token and secret lookups, and is not automatically printed. Neither successful output nor failed diagnostics enter telemetry or drafts.

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

## Manual reference

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

[`azure/provision/`](azure/provision/main.tf) creates a temporary private-network database-role provisioning job and identity in the installation's Container Apps environment. It accepts the same immutable image and exactly three versioned Key Vault references: `DATABASE_URL` for the administrator, `HUB_MIGRATION_PASSWORD`, and `HUB_RUNTIME_PASSWORD`. Each secret URL must belong to the supplied `vault_id`. Its Azure startup entrypoint retrieves those values through the provisioning identity before importing database provisioning code. Omit `registry_id` for a public image; an existing ACR requires its resource ID and grants only the provisioning identity pull access. The job has one replica, no automatic retries, and a ten-minute timeout. An authorized operator must run it once against a fresh database, verify that exact execution succeeded, and remove the temporary job, identity, and grants before release. Do not rerun it against an installed database or grant its administrator secret to Hub or setup. The existing private-network operator script remains an alternative.

Initialize each optional module against its own protected backend state key, review its declared inputs and Terraform plan, and authorize its apply separately. Never share a state key with the main installation. Neither module starts Hub or replaces the serialized release command.

The app has external HTTPS ingress and minimum and maximum one replica **per revision**. Multiple-revision mode permits explicit deactivation before releases. Azure's single-revision mode deliberately overlaps old and new processes while readiness is checked, so it is unsuitable for this maintenance-window strategy. Do not activate old revisions alongside the combined worker. This is not a high-availability or zero-downtime installation.

The runtime receives `RUNTIME_MODE=combined`, `HOST=0.0.0.0`, `PORT=3001`, `CLIENT_DIRECTORY=/app/dist/client`, `SHUTDOWN_TIMEOUT_MS=30000`, and `NODE_ENV=production`. Artifacts use `ARTIFACT_STORAGE_PROVIDER=azure`, the provisioned `AZURE_STORAGE_ACCOUNT`, `AZURE_STORAGE_CONTAINER=artifacts`, and Hub's `AZURE_CLIENT_ID`. Optional `runtime_secret_references` map environment names to vault resource IDs and HTTPS secret URLs; at most 63 additional references are allowed because the runtime database URL is the 64th. Vault and secret names in these URLs must fit Azure's 24-character and 127-character limits. Terraform passes the Key Vault URLs, including the runtime database secret reference, as the non-secret JSON map `AZURE_KEY_VAULT_SECRET_REFERENCES`, never as inline secret values or Container Apps Key Vault secret bindings.

Azure containers run `node dist/server/scripts/azure-entrypoint/index.js runtime`, `setup`, or `provision`. The entrypoint validates the complete reference map and explicit managed-identity client ID before fetching anything. It retrieves values directly from Key Vault with that identity, applies them to the workload's in-memory environment only after all reads succeed, then imports the selected workload. Startup secret retrieval has one 30-second deadline, with a bounded exponential retry for transient authorization, throttling, and service errors under the same identity; it stops on cancellation or failure before API/worker startup, database provisioning, or migrations. Secret-retrieval errors do not print token, URL, response-body, or secret contents. Registry pulling still uses Azure's normal managed-identity registry configuration; this does not bypass image-pull, DNS, or access failures.

Setup can receive only its migration `DATABASE_URL`; provisioning requires exactly its three versioned administrator/password references. Runtime requires its runtime `DATABASE_URL` and may receive validated additional references. References cannot overwrite already-defined environment values or deployment-owned configuration, including the identity and reference-map fields. Existing secret-scoped grants remain unchanged; no vault-wide access is added. Versioned URLs are recommended for deliberate rotation. An unversioned runtime/setup URL selects the latest value only at startup, not through Container Apps' background secret refresh. Restart through a reviewed serialized release to pick up a new version.

Terraform ignores only Azure-assigned PostgreSQL availability-zone and Container Apps infrastructure-resource-group values. It still checks other drift and owns both images. The installation output exposes authoritative app, resource-group, and storage-account IDs; before the first release, the app ID is `null`.

The setup job uses the same digest and command `node dist/server/scripts/azure-entrypoint/index.js setup`. Its environment settings are `NODE_ENV=production`, `RUNTIME_MODE=setup`, `DATABASE_RUNTIME_ROLE=replica_runtime`, its own `AZURE_CLIENT_ID`, and a reference map containing only its migration `DATABASE_URL` for `replica_migration`. It receives no artifact configuration or additional runtime secrets. It has one replica, no automatic retries, and a 30-minute timeout. Hub's readiness probe is `/api/ready`; startup and liveness use `/api/health`. Azure allows 60 seconds for termination, covering the 30-second application drain and up to five seconds of telemetry flushing with platform margin.

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

## Backups, restore, and migration

PostgreSQL retains point-in-time backups for `backup_retention_days` (default 14). Blob/container soft deletion retains deleted objects for 14 days; versioning preserves earlier content, but versions incur storage charges and are not an independent backup. These defaults provide neither regional disaster recovery nor high availability. Managed PostgreSQL, the app's minimum replica, private networking, logs, backups, and Blob versions have ongoing costs even when traffic is low.

Agree on acceptable data loss and recovery time with the installation owner. Schedule independent database exports and artifact copies to a separately authorized backup destination with its own retention. Run database exports from an authorized private-network host or job; PostgreSQL has no public firewall exception. Encrypt exports and never place credentials in commands, logs, or committed files.

For recovery, stop releases and Hub, record the database recovery point and matching artifact manifest, and restore PostgreSQL to a **new** server using Azure point-in-time recovery. Restore Blob versions or independent copies to a separate private container/account. Verify database records, queue state, and artifact references together. A database restore alone cannot restore matching artifact state.

Reconcile the restored resources with a reviewed Terraform configuration and import/state-migration plan before deployment; a restored server has different identifiers and this normal release script intentionally rejects replacements. Do not overwrite or delete the original resources until the restored installation has passed setup, integrity checks, HTTPS/readiness, representative authenticated operations, and a measured recovery exercise. Document the observed recovery time and data loss.

To move an existing installation, pause writes and workers, export PostgreSQL, copy artifacts with an object manifest, import both into the new installation, and verify counts/checksums and a representative operation before switching traffic. Keep source backups and a rollback window. No automatic migration between local and Azure installations is performed here.

## Guarded destruction

### Remove guided installations

Run `npm run setup:server` and choose **Remove deployments (destructive)**. Use Up/Down to move, Space to check one or more saved configurations, and Enter to submit checked options. Highlighting a row does not check it. An empty submission stays in the picker with selection guidance; to cancel, check **Back to main menu (no removal)** and press Enter. You can also add explicit config-file paths. Labels show each installation, subscription, region, and configuration path; local files do not prove that cloud resources exist. Files needing attention stay visible but cannot authorize removal.

Review the selected targets and permanent data loss, confirm once, then type each displayed deployment name exactly. A decline or name mismatch stops before cloud checks, writer locks, or resource changes. Removal creates no backups and provides no backup prompts. Only proceed for disposable data, or after arranging independent backups yourself. Confirm that other installers, releases, jobs, and administrative database work have stopped, and that the installation's registry and vault are not shared with other workloads.

The installer checks access, cloud ownership, Terraform lease status, and job executions for every selected target before lock recovery or removal. It then validates saved inputs and Terraform resource inventories under the installation's writer lock and cloud lease before deletion. It rejects unmanaged group resources, unrelated state containers or historical blob names, unknown metadata, cross-group Container Apps environment/foundation consumers, and untracked grants on the dedicated foundation. These checks cannot identify every external client; the operator must confirm that the resources are dedicated. A missing backend with remaining application or foundation resources requires manual recovery.

Consumer checks distinguish a verified shared resource from incomplete Azure metadata. They also check identity attachments and active revisions or remaining replicas of unselected Container Apps, so an older revision cannot keep using this installation's identity, registry, or vault after its latest template changes. A missing environment field on this installation's exact Hub/setup/provision workload does not make it an external consumer; state and owned-resource checks still apply before deletion. For an unselected workload with incomplete subscription-list metadata, the installer makes one targeted read-only check of that exact app or job. If it still cannot verify identity attachments, the environment, or reference fields, the error names the workload and missing field rather than claiming that resources are shared.

An actual sharing blocker identifies the unselected app/job and whether it uses this installation's identity, environment, registry, or vault. An untracked access grant identifies its exact resource ID and scope. The wizard shows the reason and remedy and offers a read-only preflight recheck, preserving your selection and existing consent. A consumer or grant, or a failed read-only Azure or Terraform command, found during a later inspection also offers an inspection-only recheck: it retains prepared modules and held leases, revalidates the configuration, inputs, and lease handles, and does not replay preparation, shutdown, or deletion. Move or remove external consumers through their own authorized lifecycle, restore missing installation-owned state when appropriate, or keep the affected installation. If the intended inventory changes, exit and restart for fresh review rather than reusing the old snapshot. The installer does not silently delete diagnostic jobs, adopt grants, or discard sharing checks. Secret URLs, image strings, environment values, and raw discovery payloads are not printed.

The original removal confirmation and typed names also authorize guarded recovery of this installation's known locks. There is no second approval for that internal cleanup. Recovery verifies ownership, terminal jobs, and fresh workload evidence before clearing only the exact scoped lock. It may stop and drain the verified Hub first, as already authorized by removal. If later work fails, Hub can remain stopped. Age, an infinite lease, or a quiet observation interval alone does not prove that the owner has exited; the original confirmation that all prior installer, Terraform, release, and administrative database work has stopped remains essential.

For a known infinite Terraform-state lease, recovery reads the current Terraform lock record and verifies its identifier, exact container/state path, owner, operation, version, creation metadata, and existing blob properties. It initializes a new private copy against the canonical selected backend and the default Terraform workspace. The lock record, state ETag, and cloud safety evidence must remain unchanged across fresh observations before it invokes Terraform's exact-ID `force-unlock`. Terraform itself checks that the current lock ID still matches; removal never issues a blanket state-lease break, disables state locking, deletes state to bypass a lock, or migrates a backend. It verifies release before continuing and never retries an ambiguous unlock result automatically. Lock identifiers and raw metadata are not printed or saved in diagnostics.

Active jobs, local workspace writers, missing or foreign lock records, changing state/evidence, and finite or unknown leases remain blockers. The error identifies the installation, subscription, exact account/container/blob, and recognized lease status. Ambiguous or apparently locked state-list metadata is checked against the current blob, rather than treating historical metadata as a live lock. Use the read-only recheck after the identified owner finishes or an authorized recovery resolves it. Unknown state is not forcibly unlocked; removal never cancels jobs, changes network rules, or adopts resources.

All selected targets receive read-only preflight first. Each installation is then recovered, prepared, and deleted completely before the next installation's cloud locks are acquired. The installer stops the verified Hub and removes Terraform-tracked temporary provisioning resources, application resources, then the dedicated foundation. A later installation can still fail preparation after earlier ones were removed; the initial review explains that partial-batch risk. It disables the app's destruction guard only in a new private copy of the module; the original guard remains enabled. AzureRM still refuses group deletion when unmanaged resources remain. Referenced external vaults, registries, DNS zones, and certificates outside these owned resources are not independently deleted. Deleting the owned environment also removes its environment-scoped resources.

Azure creates a separate managed infrastructure group, normally beginning `ME_`, for the Container Apps environment. The installer lets Azure remove it through environment deletion and waits for that cleanup; it never directly deletes the managed group. Only after all tracked states are empty, application/foundation groups are absent, and observed managed cleanup finishes does it remove the verified state account and its empty group. That final step deletes historical state versions too. An already-empty owned state group can be removed after a previous attempt deleted its account.

Original configurations, compatible drafts, logs, generated inputs, and Terraform working files remain unchanged. The installer saves target-bound, non-secret managed-group evidence in the workspace's private `environment-removal.json` before removal, so a retry still checks Azure's cleanup after the environment disappears from state. That file contains no approval or lease IDs and is retained; invalid or conflicting evidence blocks removal. Only the new private removal staging is cleaned. Retained local state and inputs can still contain credentials; keep their directory private. Removal does not consume a setup draft, and a retained configuration is not permission to recreate deleted resources.

An initial read-only preflight command failure or non-recoverable lease stays in the wizard with **Recheck read-only preflight**, **Show full error details**, and **Exit and keep saved progress**. Rechecking keeps the selected configurations and typed consent, verifies the same saved target again, and repeats no resource changes. The recheck itself never acquires or clears a cloud lease; eligible lock recovery is a later, separately checked part of confirmed removal. After the batch passes preflight, the installer rediscovers state under its lease and blocks later state-key changes instead of relying on pre-retry results. State inventory includes deleted blobs, snapshots, and versions across all pages; Azure CLI's `--include dsv` takes those dataset flags as one combined value.

Failures during later preparation or removal stay in an error-review panel until you choose to exit; except for the inspection-only recheck above, they do not offer a retry. The summary distinguishes failure before deletion/shutdown from possible partial changes and identifies completed and remaining targets. Cancellation exits promptly. There is no automatic destructive retry or rollback: earlier targets may already be gone, and the current target may be partially removed. Review actual cloud status before retrying. Remaining acquired leases are retained for recovery; after a failed state-account deletion, its result and lease may be unknown. A new confirmed removal can recover eligible operational locks through the guarded path above. Exit before any separate manual state-lock recovery; never break a lock merely because it blocks deletion. Do not remove state first or delete entire groups to bypass a blocker. Unmanaged diagnostic jobs, such as a separate probe, require their own authorized review and cleanup.

Removal is interactive only, is hidden in `--configure-only`, and cannot be authorized by `--non-interactive --approve-deployment`. It needs Azure CLI access and the supported Terraform version, not a Docker build. Purge-protected vaults are soft-deleted without a purge request; their retention and other Azure-retained data or charges may outlast removal.

### Manual application-module destruction

The existing command below removes only the application Terraform module, not the guided foundation or state backend. Destruction removes database and artifact state. Take verified independent backups first. The default app lifecycle guard intentionally prevents a complete destroy: remove **only** the app's `prevent_destroy` block in a reviewed local change after the owner authorizes permanent deletion. Restore the guard afterward. For a bootstrap that never created the app, no guard edit is needed.

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

import { createHash, randomUUID } from "node:crypto"
import { dirname, join, resolve } from "node:path"
import { rm } from "node:fs/promises"

import { loadConfig, parseConfig } from "../../installer/config/index.ts"
import { readSession } from "../../installer/session/index.ts"
import { readPrivateFile, writePrivateFile } from "../../installer/private-files/index.ts"
import { promptForRecovery } from "../../installer/prompt-for-recovery/index.ts"
import { describeCommand } from "../../installer/command/describe/index.ts"
import type { PostSetupAction, RunCommand, WizardUI } from "../../installer/types.ts"
import { terraformModule } from "../../terraform/index.ts"
import { existingRoleAssignment } from "../install/existing-role-assignment/index.ts"
import { acquireLease } from "../install/lease/index.ts"
import { readInstallationInputs } from "../install/inputs/index.ts"
import { installationNames } from "../install/settings.ts"
import { verifyAzureTarget } from "../install/preflight/index.ts"
import { verifyInstallationGroup } from "../install/group/index.ts"
import { openInstallationWorkspace } from "../install/workspace/index.ts"
import type { AzureInstallation } from "../install/types.ts"
import { stopHub } from "../stop-hub/index.ts"
import { configurePostSetup } from "./configure/index.ts"
import { readPostDeployment } from "./deployment/index.ts"
import { validatePostPlan } from "./validate-plan/index.ts"
import { verifyPostSetup } from "./verify/index.ts"
import type { PostInputs, PostSetupTarget } from "./types.ts"
import { PostSetupExit } from "./errors.ts"
import { isBoundPostOrigin } from "./bound-origin/index.ts"

export async function postSetupAzure(
  input: PostSetupTarget,
  {
    action,
    run,
    ui,
    signal,
    request,
  }: {
    action: PostSetupAction
    run: RunCommand
    ui: WizardUI
    signal?: AbortSignal
    request?: typeof fetch
  },
): Promise<string> {
  signal?.throwIfAborted()
  if (!["sign-in", "github", "restart"].includes(action))
    throw new Error("Choose a supported post-setup action.")
  const target = { path: resolve(input.path), config: parseConfig(input.config) }
  const config = target.config
  const recoveryUI: WizardUI = {
    ...ui,
    notice(level, message) {
      if (level === "error" && ui.recoveryNotice) ui.recoveryNotice(message)
      else ui.notice?.(level, message)
    },
  }
  const names = installationNames(config)
  async function checkConfig() {
    signal?.throwIfAborted()
    if (JSON.stringify(await loadConfig(target.path)) !== JSON.stringify(config))
      throw new Error(
        "The selected installation configuration changed. Post-setup stopped without retargeting it.",
      )
    const session = await readSession(target.path)
    if (session.problem || session.draft)
      throw new Error("Finish or review the saved setup draft before post-setup; it was preserved.")
  }
  await checkConfig()
  let cleanupSignal: AbortSignal | undefined
  const execute: RunCommand = (executable, args, options) => {
    const activeSignal = cleanupSignal ?? signal
    activeSignal?.throwIfAborted()
    ui.status(describeCommand(executable, args).label)
    return run(executable, args, { ...options, signal: activeSignal })
  }
  await verifyAzureTarget(config, execute)
  const workspace = await openInstallationWorkspace(config, dirname(target.path))
  const locks: Awaited<ReturnType<typeof acquireLease>>[] = []
  let success = false
  let desiredSaved = false
  let changesStarted = false
  let temporaryBackend: string | undefined
  let bootstrapFile: string | undefined
  let finishPrompts: (() => Promise<void>) | undefined
  try {
    const env: NodeJS.ProcessEnv = {
      ARM_SUBSCRIPTION_ID: config.azure.subscriptionId,
      ARM_TENANT_ID: config.azure.tenantId,
      ARM_USE_CLI: "true",
      ARM_USE_OIDC: "false",
      ARM_USE_MSI: "false",
      ARM_CLIENT_ID: undefined,
      ARM_CLIENT_SECRET: undefined,
      ARM_CLIENT_CERTIFICATE_PATH: undefined,
      ARM_CLIENT_CERTIFICATE_PASSWORD: undefined,
      ARM_OIDC_TOKEN: undefined,
      TF_WORKSPACE: "default",
    }
    for (const key of Object.keys(process.env))
      if (
        key.startsWith("TF_VAR_") ||
        key.startsWith("TF_CLI_ARGS") ||
        [
          "TF_LOG",
          "TF_LOG_PATH",
          "ARM_ACCESS_KEY",
          "ARM_SAS_TOKEN",
          "ARM_OIDC_TOKEN_FILE_PATH",
        ].includes(key)
      )
        env[key] = undefined
    const context: AzureInstallation & { ui: WizardUI } = {
      config,
      directory: workspace.directory,
      ui: recoveryUI,
      run: execute,
      signal,
      env,
      azure: (...args) =>
        execute("az", [
          ...args,
          "--subscription",
          config.azure.subscriptionId,
          "--only-show-errors",
          "--output",
          "json",
        ]),
    }
    await ui.phase?.("checks")
    const deployment = await readPostDeployment(context, { allowStopped: action !== "restart" })
    const inputsPath = join(workspace.directory, "installation.tfvars.json")
    const original = await readPrivateFile(inputsPath, { createDirectory: false })
    if (original === undefined)
      throw new Error(
        "Post-setup needs this installation's saved generated inputs; it will not bootstrap or adopt resources.",
      )
    // Sign-in setup can repair a missing origin; the saved result is validated before Terraform.
    await readInstallationInputs(workspace.directory, config, {
      allowMissingAuthenticationOrigin: action === "sign-in",
    })
    const saved = JSON.parse(original) as PostInputs
    const runtimeDatabase = saved.runtime_database_secret as
      { key_vault_id?: string; secret_id?: string } | undefined
    if (
      !runtimeDatabase ||
      typeof runtimeDatabase.key_vault_id !== "string" ||
      typeof runtimeDatabase.secret_id !== "string" ||
      typeof saved.image !== "string"
    )
      throw new Error("The saved deployment references are incomplete. They were not replaced.")
    const liveReferences: unknown = JSON.parse(
      deployment.environment.AZURE_KEY_VAULT_SECRET_REFERENCES ?? "null",
    )
    if (!liveReferences || typeof liveReferences !== "object" || Array.isArray(liveReferences))
      throw new Error("The deployed startup secret references are missing or unsupported.")
    const savedReferences = {
      DATABASE_URL: runtimeDatabase.secret_id,
      ...Object.fromEntries(
        Object.entries(saved.runtime_secret_references ?? {}).map(([key, reference]) => [
          key,
          reference.secret_id,
        ]),
      ),
    }
    const journalPath = join(workspace.directory, "post-desired.json")
    const journalContent = await readPrivateFile(journalPath, { createDirectory: false })
    const journal =
      journalContent === undefined
        ? undefined
        : (JSON.parse(journalContent) as {
            target?: string
            hash?: string
            phase?: string
            action?: string
            previousReferences?: Record<string, string>
          })
    if (
      journalContent !== undefined &&
      (!journal ||
        journal.target !== JSON.stringify(config) ||
        !["pending", "complete"].includes(String(journal.phase)) ||
        !["sign-in", "github"].includes(String(journal.action)) ||
        typeof journal.hash !== "string" ||
        !/^[a-f0-9]{64}$/.test(journal.hash))
    )
      throw new Error(
        "Post-setup recovery evidence is invalid or belongs to another installation. It was preserved.",
      )
    if (
      journal?.phase === "pending" &&
      journal.hash !== createHash("sha256").update(original).digest("hex")
    )
      throw new Error(
        "The pending post-setup marker does not match the saved desired inputs. Preserve the marker, inputs, backups and progress files and review them together before resuming.",
      )
    const pending = journal?.phase === "pending"
    changesStarted = pending
    if (pending && journal?.action !== action)
      throw new Error(
        `Finish the pending ${journal?.action} configuration action before another post-setup action.`,
      )
    const changedSecretKeys =
      action === "github"
        ? [
            "GITHUB_CLIENT_SECRET",
            "GITHUB_APP_PRIVATE_KEY_BASE64",
            "GITHUB_WEBHOOK_SECRET",
            "HUB_AUTHENTICATION_ENCRYPTION_KEY",
            "HUB_BOOTSTRAP_SECRET",
            "HUB_APPLICATION_ORIGIN",
          ]
        : action === "sign-in"
          ? ["HUB_AUTHENTICATION_ENCRYPTION_KEY", "HUB_BOOTSTRAP_SECRET", "HUB_APPLICATION_ORIGIN"]
          : []
    const activeReferences = liveReferences as Record<string, unknown>
    if (
      [...new Set([...Object.keys(activeReferences), ...Object.keys(savedReferences)])].some(
        (key) => {
          const live = activeReferences[key]
          const desired = savedReferences[key as keyof typeof savedReferences]
          if (live !== undefined && typeof live !== "string") return true
          if (desired === live) return false
          return !(
            desired !== undefined &&
            changedSecretKeys.includes(key) &&
            (live === undefined || (pending && journal?.previousReferences?.[key] === live))
          )
        },
      )
    )
      throw new Error(
        "Deployed secret references differ from the saved inputs. Reconcile the desired configuration before post-setup; no live settings were overwritten.",
      )
    if (
      action === "restart" &&
      Object.values(activeReferences).some(
        (value) =>
          typeof value !== "string" ||
          !/^https:\/\/[a-z0-9-]{1,24}\.vault\.azure\.net\/secrets\/[a-z0-9-]{1,127}\/[a-f0-9]{32}$/i.test(
            value,
          ),
      )
    )
      throw new Error(
        "Restart requires every live runtime Key Vault reference, including DATABASE_URL, to be version-pinned. Review unpinned references before restarting.",
      )
    const namedSettings = (inputs: PostInputs) =>
      Object.fromEntries(
        Object.entries({
          HUB_APPLICATION_ORIGIN: inputs.hub_application_origin,
          GITHUB_APP_ID: inputs.github_app_id,
          GITHUB_CLIENT_ID: inputs.github_client_id,
          GITHUB_APP_INSTALLATION_ID: inputs.github_app_installation_id,
          GITHUB_PROVIDER_REVISION: inputs.github_provider_revision,
        })
          .filter(([, value]) => value !== undefined && value !== null)
          .map(([key, value]) => [key, String(value)]),
      )
    const desiredSettings = { ...saved.runtime_environment_variables, ...namedSettings(saved) }
    const editableSettings =
      action === "sign-in"
        ? ["HUB_APPLICATION_ORIGIN", "HUB_TRUSTED_PROXY_HOPS"]
        : action === "github"
          ? [
              "GITHUB_APP_ID",
              "GITHUB_CLIENT_ID",
              "GITHUB_APP_INSTALLATION_ID",
              "GITHUB_PROVIDER_REVISION",
            ]
          : []
    const deploymentSettings = [
      "NODE_ENV",
      "RUNTIME_MODE",
      "HOST",
      "PORT",
      "CLIENT_DIRECTORY",
      "SHUTDOWN_TIMEOUT_MS",
      "ARTIFACT_STORAGE_PROVIDER",
      "AZURE_STORAGE_ACCOUNT",
      "AZURE_STORAGE_CONTAINER",
      "AZURE_CLIENT_ID",
      "AZURE_KEY_VAULT_SECRET_REFERENCES",
    ]
    if (
      action !== "restart" &&
      [...new Set([...Object.keys(desiredSettings), ...Object.keys(deployment.environment)])].some(
        (key) =>
          !deploymentSettings.includes(key) &&
          !editableSettings.includes(key) &&
          !(
            key === "GITHUB_PROVIDER_REVISION" &&
            action === "sign-in" &&
            pending &&
            desiredSettings.HUB_APPLICATION_ORIGIN !== deployment.environment.HUB_APPLICATION_ORIGIN
          ) &&
          desiredSettings[key] !== deployment.environment[key],
      )
    )
      throw new Error(
        "Unrelated deployed runtime settings differ from the saved inputs. Reconcile them before post-setup; no live settings were overwritten.",
      )
    if (
      !(await ui.confirm(
        `${action === "restart" ? "Restart the active Hub revision" : "Configure this existing Hub"}: ${config.name}\nSubscription ${config.azure.subscriptionId}; tenant ${config.azure.tenantId}; app ${deployment.appId}\nDeployed image (reused unchanged): ${deployment.image}\n${
          action === "restart"
            ? `Restart only ${deployment.revision}; keep all settings and pinned secret versions.`
            : "Secret creation and desired-input persistence may occur before the checked Terraform plan is approved. Only runtime settings and secret-scoped Hub read grants may change. A configuration update stops old Hub replicas and creates a new revision; downtime is possible."
        }\nNo image build/publication, infrastructure bootstrap, database setup/migrations or full release will run.\nConfirm no other installer, Terraform, release or administrative database operation is running for this installation, including other terminals/machines/CI. Continue?`,
      ))
    )
      throw new DOMException("Post-setup cancelled before changes.", "AbortError")
    await checkConfig()
    const strict = { ...context, ui: { ...ui, select: undefined } }
    locks.push(
      await acquireLease(strict, names.stateAccount, "terraform", `${config.name}/installer.lock`),
    )
    locks.push(
      await acquireLease(
        strict,
        `${config.name.replaceAll("-", "")}hub`,
        "releases",
        "deployment.lock",
      ),
    )
    let expectedInputs = original
    const verify = async () => {
      await checkConfig()
      if ((await readPrivateFile(inputsPath, { createDirectory: false })) !== expectedInputs)
        throw new Error(
          "Saved desired inputs changed during post-setup. No further changes were started.",
        )
      for (const lock of locks) await lock.verify()
    }
    await verify()
    const fresh = await readPostDeployment(context, { allowStopped: action !== "restart" })
    if (JSON.stringify(fresh) !== JSON.stringify(deployment))
      throw new Error(
        "The active deployment changed during approval. Restart post-setup to review it.",
      )
    let desired = saved
    let runtimeUpdateStarted = false
    if (action === "restart") {
      changesStarted = true
      await context.azure(
        "containerapp",
        "revision",
        "restart",
        "--name",
        deployment.appName,
        "--resource-group",
        config.azure.resourceGroup,
        "--revision",
        deployment.revision,
      )
    } else {
      await ui.phase?.("configure")
      if (!(await verifyInstallationGroup(context, names.foundationGroup)))
        throw new Error(
          "This installation's foundation is missing. Post-setup will not recreate it.",
        )
      const vault = JSON.parse(
        await context.azure(
          "keyvault",
          "show",
          "--name",
          names.vault,
          "--resource-group",
          names.foundationGroup,
          "--query",
          "{id:id,rbac:properties.enableRbacAuthorization,softDelete:properties.enableSoftDelete,purgeProtection:properties.enablePurgeProtection}",
        ),
      ) as { id?: string; rbac?: boolean; softDelete?: boolean; purgeProtection?: boolean }
      const vaultId = `/subscriptions/${config.azure.subscriptionId}/resourceGroups/${names.foundationGroup}/providers/Microsoft.KeyVault/vaults/${names.vault}`
      if (
        vault.id?.toLowerCase() !== vaultId.toLowerCase() ||
        !vault.rbac ||
        !vault.softDelete ||
        !vault.purgeProtection
      )
        throw new Error(
          "The installation's protected RBAC Key Vault could not be verified. No access policy was changed.",
        )
      desired = await configurePostSetup(
        {
          ...context,
          onBootstrapFile: (path) => {
            bootstrapFile = path
          },
          onPrepared: (finish) => {
            finishPrompts = finish
          },
          onMutation: () => {
            changesStarted = true
          },
        },
        action,
        saved,
        deployment,
      )
      desired.image = deployment.image
      desired.deploy_hub = true
      await verify()
      await writePrivateFile(
        join(workspace.directory, `post-inputs-backup-${randomUUID()}.json`),
        original,
        { exclusive: true },
      )
      expectedInputs = JSON.stringify(desired)
      changesStarted = true
      await writePrivateFile(
        journalPath,
        JSON.stringify({
          target: JSON.stringify(config),
          hash: createHash("sha256").update(expectedInputs).digest("hex"),
          phase: "pending",
          action,
          previousReferences: liveReferences,
        }),
      )
      await writePrivateFile(inputsPath, expectedInputs)
      desiredSaved = true
      await readInstallationInputs(workspace.directory, config)
      await finishPrompts?.()
      temporaryBackend = join(workspace.directory, `post-backend-${randomUUID()}.hcl`)
      await writePrivateFile(
        temporaryBackend,
        [
          `resource_group_name = ${JSON.stringify(names.stateGroup)}`,
          `storage_account_name = ${JSON.stringify(names.stateAccount)}`,
          'container_name = "terraform"',
          `key = ${JSON.stringify(`${config.name}/app.tfstate`)}`,
          "use_azuread_auth = true",
          "use_oidc = false",
          `subscription_id = ${JSON.stringify(config.azure.subscriptionId)}`,
          `tenant_id = ${JSON.stringify(config.azure.tenantId)}`,
          "",
        ].join("\n"),
        { exclusive: true },
      )
      const moduleDirectory = resolve(import.meta.dirname, "..")
      const dataDirectory = join(workspace.directory, "terraform", "post")
      let appChanged = false
      const environment = { ...deployment.environment }
      const configuredSettings = {
        ...desired.runtime_environment_variables,
        ...namedSettings(desired),
      }
      const allowedSettings =
        action === "sign-in" ? [...editableSettings, "GITHUB_PROVIDER_REVISION"] : editableSettings
      for (const key of allowedSettings)
        if (configuredSettings[key] === undefined) delete environment[key]
        else environment[key] = configuredSettings[key]
      const configuredReferences = { ...activeReferences }
      for (const key of changedSecretKeys) {
        const reference = desired.runtime_secret_references?.[key]
        if (reference) configuredReferences[key] = reference.secret_id
        else delete configuredReferences[key]
      }
      environment.AZURE_KEY_VAULT_SECRET_REFERENCES = JSON.stringify(configuredReferences)
      const secretScopes = Object.values(desired.runtime_secret_references ?? {})
        .map(
          (reference) =>
            `${reference.key_vault_id}/secrets/${new URL(reference.secret_id).pathname.split("/")[2]}`,
        )
        .filter((scope) => scope.toLowerCase().startsWith(`${vaultId.toLowerCase()}/secrets/`))
      const module = terraformModule({
        directory: moduleDirectory,
        dataDirectory,
        env,
        run: execute,
        ui: recoveryUI,
        signal,
        findUntracked: existingRoleAssignment(context.azure, config.azure.subscriptionId),
        requireUntrackedCheck: true,
        validatePlan: (value) => {
          validatePostPlan(value, {
            appId: deployment.appId,
            image: deployment.image,
            principalId: deployment.principalId,
            secretScopes,
            environment,
          })
          appChanged = (
            value as { resource_changes: { address: string; change: { actions: string[] } }[] }
          ).resource_changes.some(
            (resource) =>
              resource.address === "azurerm_container_app.hub[0]" &&
              resource.change.actions.includes("update"),
          )
          if (!deployment.active && !appChanged)
            throw new Error(
              "Hub is stopped and this plan would not create a new configured revision. Review the failed rollout; no old revision was activated.",
            )
        },
        beforeApply: async () => {
          await verify()
          changesStarted = true
          if (appChanged) {
            runtimeUpdateStarted = true
            ui.status(
              "Stopping this Hub's old replicas before its runtime-only configuration update.",
            )
            await stopHub({
              name: deployment.appName,
              resourceGroup: config.azure.resourceGroup,
              command: async (...args) => {
                const output = await context.azure(...args)
                return args[2] === "deactivate" ? undefined : (JSON.parse(output) as unknown)
              },
            })
          }
        },
      })
      await module.init(temporaryBackend)
      ui.recoveryNotice?.()
      const output = await module.output<{
        app_id?: string
        resource_group?: string
        storage_account?: string
      }>("installation")
      if (
        output.app_id?.toLowerCase() !== deployment.appId.toLowerCase() ||
        output.resource_group !== config.azure.resourceGroup ||
        output.storage_account !== `${config.name.replaceAll("-", "")}hub`
      )
        throw new Error(
          "Terraform backend does not describe this deployed Hub. No configuration apply was started.",
        )
      const state = JSON.parse(
        await execute("terraform", [`-chdir=${moduleDirectory}`, "show", "-json"], {
          env: { ...env, TF_DATA_DIR: dataDirectory },
        }),
      ) as {
        values?: {
          root_module?: { resources?: { address?: string; values?: Record<string, unknown> }[] }
        }
      }
      const resources = state.values?.root_module?.resources
      const database = resources?.find(
        (resource) => resource.address === "azurerm_postgresql_flexible_server.database",
      )
      const identity = resources?.find(
        (resource) => resource.address === "azurerm_user_assigned_identity.hub",
      )
      const app = resources?.find((resource) => resource.address === "azurerm_container_app.hub[0]")
      if (
        !app ||
        app.values?.id !== deployment.appId ||
        identity?.values?.principal_id !== deployment.principalId ||
        typeof database?.values?.administrator_password !== "string"
      )
        throw new Error(
          "The app state, identity or existing database input could not be verified. No credential was generated or replaced.",
        )
      env.TF_VAR_postgres_admin_password = database.values.administrator_password
      try {
        await module.apply(inputsPath)
        ui.recoveryNotice?.()
      } finally {
        delete env.TF_VAR_postgres_admin_password
      }
    }
    let publicOrigin =
      action === "restart"
        ? deployment.origin
        : (desired.hub_application_origin ??
          desired.runtime_environment_variables?.HUB_APPLICATION_ORIGIN)
    if (!publicOrigin && desired.runtime_secret_references?.HUB_APPLICATION_ORIGIN) {
      const value: unknown = JSON.parse(
        await context.azure(
          "keyvault",
          "secret",
          "show",
          "--id",
          desired.runtime_secret_references.HUB_APPLICATION_ORIGIN.secret_id,
          "--query",
          "value",
        ),
      )
      if (!isBoundPostOrigin(value, deployment))
        throw new Error("The existing secret-backed public origin is not bound to this Hub.")
      publicOrigin = value
    }
    if (!publicOrigin) throw new Error("The configured public origin could not be verified.")
    await ui.phase?.("verify")
    while (true) {
      try {
        await verify()
        await verifyPostSetup(context, deployment, {
          origin: publicOrigin,
          setup: action !== "restart",
          github: action === "github",
          restart: action === "restart" || !runtimeUpdateStarted,
          request,
        })
        ui.recoveryNotice?.()
        break
      } catch (error) {
        signal?.throwIfAborted()
        if (!(error instanceof Error)) throw error
        await promptForRecovery(recoveryUI, {
          error,
          question: "Post-setup verification needs review.",
          message:
            "Configuration or restart may already have succeeded. Recheck only; do not replay mutations or discard desired inputs.",
          actions: [
            { label: "Recheck readiness and requested setup availability only", value: "verify" },
          ],
        })
      }
    }
    for (const lock of [...locks].reverse()) await lock.release()
    if (action !== "restart")
      await writePrivateFile(
        journalPath,
        JSON.stringify({
          target: JSON.stringify(config),
          hash: createHash("sha256").update(expectedInputs).digest("hex"),
          phase: "complete",
          action,
        }),
      )
    success = true
    ui.complete?.()
    return `${config.name}: ${action === "restart" ? "active Hub revision restarted" : "post-setup configuration applied"} using the unchanged deployed image.\n${publicOrigin}${action !== "restart" ? "/settings/github/setup" : ""}\n${action === "github" ? "GitHub sign-in is enabled. Verify the App connection, administrator enrollment, OAuth callback and signed webhooks separately." : action === "sign-in" ? "Setup access is available. GitHub sign-in remains dependent on the configured App credentials." : "Settings and pinned secret versions were retained."}${bootstrapFile ? `\nBootstrap secret saved privately: ${bootstrapFile}. Escrow it before removing this local copy.` : ""}`
  } catch (error) {
    if (changesStarted) {
      const summary = `Post-setup stopped; secrets or runtime changes may be partial, and Hub may remain stopped. ${desiredSaved ? "Desired inputs and their private backup were saved; rerun the same post-setup action to replan." : "Previous inputs were retained; rerun after reviewing the failed step. Named shared secrets already created will be reused."} No rollback, database setup, image rebuild, or lock breaking was attempted. If Azure created a grant not recorded in state, reconcile that exact resource before retrying.${bootstrapFile ? ` Bootstrap secret retained privately at ${bootstrapFile}.` : ""}`
      if (ui.recoveryNotice) ui.recoveryNotice(summary)
      else ui.notice?.("error", summary)
      if (error instanceof PostSetupExit) throw new PostSetupExit(summary, true)
    }
    throw error
  } finally {
    try {
      if (!success && !changesStarted) {
        cleanupSignal = AbortSignal.timeout(15_000)
        for (const lock of [...locks].reverse()) if (lock.held) await lock.release()
      }
    } finally {
      cleanupSignal = undefined
      if (!success) for (const lock of locks) lock.reportRetained()
      try {
        if (temporaryBackend) await rm(temporaryBackend, { force: true })
      } finally {
        await workspace.close()
      }
    }
  }
}

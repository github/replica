import { randomUUID } from "node:crypto"
import { rm } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { setTimeout as delay } from "node:timers/promises"

import { assertDraftMatchesConfig, loadConfig, parseConfig } from "../../installer/config/index.ts"
import { CommandExecutionError } from "../../installer/command/index.ts"
import { promptForRecovery } from "../../installer/prompt-for-recovery/index.ts"
import { privateDirectory } from "../../installer/private-files/index.ts"
import { openSession } from "../../installer/session/index.ts"
import { installationWorkspace } from "../../installer/workspace/index.ts"
import type { RemovalTarget, RunCommand, WizardUI } from "../../installer/types.ts"
import { acquireLease } from "../install/lease/index.ts"
import { recoverLease } from "../install/lease/recover/index.ts"
import { installationNames } from "../install/settings.ts"
import { verifyAzureTarget } from "../install/preflight/index.ts"
import { openInstallationWorkspace } from "../install/workspace/index.ts"
import { stopHub } from "../stop-hub/index.ts"
import { inspectRemoval } from "./inspect/index.ts"
import { removalEnvironment } from "./environment/index.ts"
import { prepareRemovalModule } from "./prepare-module/index.ts"
import { RemovalLeaseError } from "./lease-error/index.ts"
import { RemovalInspectionError } from "./inspection-error/index.ts"
import { recoverTerraformState } from "./recover-state/index.ts"
import type { RemovalContext, RemovalModule, RemovalResource } from "./types.ts"

export async function removeAzureDeployments(
  input: readonly RemovalTarget[],
  { run, ui, signal }: { run: RunCommand; ui: WizardUI; signal?: AbortSignal },
): Promise<string> {
  signal?.throwIfAborted()
  if (!input.length || !ui.select)
    throw new Error(
      "Removal requires interactive selection, confirmation, and typed deployment names.",
    )
  const targets = input.map(({ path, config }) => ({
    path: resolve(path),
    config: parseConfig(config),
  }))
  const keys = targets.map(({ config }) => `${config.azure.subscriptionId}/${config.name}`)
  for (const { config } of targets) {
    const names = installationNames(config)
    if (
      [names.stateGroup, names.foundationGroup].some(
        (group) => group.toLowerCase() === config.azure.resourceGroup.toLowerCase(),
      )
    )
      throw new Error(
        "Removal requires separate application, foundation, and state resource groups.",
      )
  }
  if (
    new Set(keys).size !== targets.length ||
    new Set(targets.map(({ path }) => path)).size !== targets.length
  )
    throw new Error(
      "Select only one configuration for each deployment; duplicate targets cannot be removed together.",
    )
  ui.removal?.(true)
  const review = [
    "Permanently remove these selected deployments and all their database, queue, artifact, image, and secret data?",
    ...targets.map(
      ({ path, config }) =>
        `${config.name} | tenant ${config.azure.tenantId} | subscription ${config.azure.subscriptionId} | region ${config.azure.location} | ${path}`,
    ),
    "",
    "No backups will be created. Application resources are removed first, then dedicated foundation resources, and state storage last, including historical state versions.",
    "Hub will be stopped. Local configurations, drafts, logs and original Terraform working files are retained.",
    "By continuing, confirm all other installer, Terraform, release, and administrative database processes for these deployments have stopped, including other terminals, machines, and CI.",
    "Confirm their resource groups, storage, databases, registries and vaults are dedicated to these installations, not shared with other workloads. Consumer checks cannot discover every external client.",
    "Active jobs, changing or unverifiable Terraform locks, finite or unknown leases, unverified ownership, and unmanaged resources block removal. Jobs are not forcibly cancelled.",
    "This removal approval includes scoped recovery of verified Terraform-state locks and known infinite installation/release locks after fresh ownership, metadata stability, job, and Hub safety checks. A lease or its age is not proof that another owner has stopped; your confirmation that all prior processes have stopped remains essential.",
    "Deployments are deleted one at a time. Future deployments' cloud locks are not acquired in advance.",
    "Azure-managed environment resources are removed through the environment lifecycle. Purge-protected vaults and other Azure retention can outlast removal.",
    "A failure stops the batch; earlier deployments may already be removed and a failed deployment may be partly removed. There is no automatic rollback.",
    "",
    "Confirm permanent removal?",
  ].join("\n")
  if (!(await ui.confirm(review)))
    throw new DOMException("Removal cancelled before any resource changes.", "AbortError")
  for (const { config } of targets) {
    signal?.throwIfAborted()
    if (
      (await ui.text(
        `Type the deployment name exactly to authorize permanent deletion: ${config.name}`,
      )) !== config.name
    )
      throw new Error("Typed deployment name did not match. No removal was started.")
  }
  signal?.throwIfAborted()
  const execute: RunCommand = (executable, args, options) => {
    signal?.throwIfAborted()
    return run(executable, args, { ...options, ...(signal && { signal }) })
  }
  const closes: (() => Promise<void>)[] = []
  const staging: string[] = []
  const prepared: {
    context: RemovalContext
    absent: boolean
    inspection: Awaited<ReturnType<typeof inspectRemoval>>
    modules: Awaited<ReturnType<typeof prepareRemovalModule>>[]
    lock?: Awaited<ReturnType<typeof acquireLease>>
    release?: Awaited<ReturnType<typeof acquireLease>>
    backendDeletionRequested?: boolean
    backendDeleted: boolean
    managedGroup?: string
  }[] = []
  const removed: string[] = []
  let failed = false
  let changesStarted = false
  let recoveryHandled = false
  let failureSummary: string | undefined
  async function unchanged(target: RemovalTarget) {
    if (JSON.stringify(await loadConfig(target.path)) !== JSON.stringify(target.config))
      throw new Error("Selected configuration changed after removal approval. Deletion stopped.")
  }
  function unchangedStates(
    states: ReadonlySet<string>,
    modules: readonly { kind: RemovalModule }[],
    name: string,
  ) {
    const expected = new Set([
      `${name}/installer.lock`,
      ...modules.map(({ kind }) => `${name}/${kind}.tfstate`),
    ])
    if (states.size !== expected.size || [...states].some((key) => !expected.has(key)))
      throw new Error(
        "Terraform state keys changed during removal. No further removal was started; review the remaining backend.",
      )
  }
  async function inspectChecked(
    context: RemovalContext,
    resources: readonly RemovalResource[] | undefined,
    held: Parameters<typeof inspectRemoval>[2],
  ) {
    while (true) {
      signal?.throwIfAborted()
      await unchanged(context.target)
      const deployment = prepared.find(({ context: candidate }) => candidate === context)
      for (const module of deployment?.modules ?? []) await module.verifyInputs()
      if (held?.installation) {
        if (!deployment?.lock?.held)
          throw new Error(
            "Removal no longer holds the expected installation lease. Inspection did not continue.",
          )
        await deployment.lock.verify()
      }
      if (held?.release) {
        if (!deployment?.release?.held)
          throw new Error(
            "Removal no longer holds the expected release lease. Inspection did not continue.",
          )
        await deployment.release.verify()
      }
      try {
        return await inspectRemoval(context, resources, held)
      } catch (error) {
        if (!(error instanceof RemovalInspectionError) || signal?.aborted) throw error
        try {
          await promptForRecovery(ui, {
            error,
            question: `Read-only removal inspection needs attention for ${context.config.name}.`,
            message: [
              error.message.split("\n").slice(1).join("\n"),
              changesStarted
                ? "Removal or Hub shutdown has already started. This recheck repeats only inspection, not shutdown, Terraform changes, or deletion. Previously completed changes are not rolled back."
                : "No deployment resources have been removed or stopped. This recheck repeats only inspection; selected targets, prepared modules, and already-held cloud leases are retained.",
              "Resolve the specific consumer or grant outside this installer only through its authorized lifecycle, then recheck. Do not clear the installer's held leases while it is running.",
            ].join("\n\n"),
            actions: [{ label: "Recheck read-only preflight", value: "retry" }],
            details:
              "The same configuration, saved inputs, held lease handles, and resource inventory are checked again before continuing. This does not bypass shared-resource checks or repeat a destructive command. If the inventory or intended scope must change, exit and restart for fresh review.",
          })
        } catch (recoveryError) {
          recoveryHandled = true
          throw recoveryError
        }
      }
    }
  }
  try {
    for (const target of targets) {
      await unchanged(target)
      const session = await openSession(target.path)
      closes.push(() => session.close())
      if (session.problem) throw new Error(session.problem)
      assertDraftMatchesConfig(target.config, session.draft)
      const config = target.config
      const directory = installationWorkspace(config, dirname(target.path))
      const context: RemovalContext = {
        target,
        config,
        directory,
        run: execute,
        ui,
        signal,
        env: {
          ARM_SUBSCRIPTION_ID: config.azure.subscriptionId,
          ARM_TENANT_ID: config.azure.tenantId,
          ARM_USE_CLI: "true",
          ARM_USE_OIDC: "false",
          ARM_CLIENT_ID: undefined,
          ARM_CLIENT_SECRET: undefined,
          ARM_CLIENT_CERTIFICATE_PATH: undefined,
          ARM_OIDC_TOKEN: undefined,
          TF_WORKSPACE: "default",
        },
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
      let inspection: Awaited<ReturnType<typeof inspectRemoval>>
      let rechecking = false
      while (true) {
        signal?.throwIfAborted()
        await unchanged(target)
        try {
          await verifyAzureTarget(config, execute)
          inspection = await inspectRemoval(context, undefined, {
            collectRetained: true,
            collectStateLocks: true,
          })
          if (rechecking)
            ui.notice?.(
              "info",
              "Read-only preflight recheck passed. Continuing with the selected deployments.",
            )
          break
        } catch (error) {
          if (
            signal?.aborted ||
            !(
              error instanceof CommandExecutionError ||
              error instanceof RemovalLeaseError ||
              error instanceof RemovalInspectionError
            ) ||
            (error instanceof CommandExecutionError && error.aborted)
          )
            throw error
          try {
            await promptForRecovery(ui, {
              error,
              question: `Read-only removal preflight failed for ${config.name}.`,
              message: [
                ...(error instanceof RemovalLeaseError || error instanceof RemovalInspectionError
                  ? [error.message.split("\n").slice(1).join("\n")]
                  : []),
                "No deployment resources have been removed or stopped, and no cloud leases have been acquired for this batch. Your selected deployments and typed confirmation are retained. Review the identified blocker, then recheck the same target after its owner finishes or the metadata/access problem is resolved.",
              ].join("\n\n"),
              actions: [{ label: "Recheck read-only preflight", value: "retry" }],
              details:
                "This recheck repeats only target verification and read-only cloud inspection. It does not stop Hub, acquire or break cloud leases, change permissions, or apply a Terraform plan. Ownership, state, and lock checks remain mandatory. Exit if the command or configuration needs a code change; restarting requires fresh destructive consent.",
            })
          } catch (error) {
            recoveryHandled = true
            throw error
          }
          rechecking = true
        }
      }
      if (
        !inspection.absent &&
        !inspection.backendAbsent &&
        !(await privateDirectory(directory, { create: false }))
      )
        throw new Error(
          "Cloud resources exist but the original private installation workspace is missing. Restore it before removal.",
        )
      prepared.push({
        context,
        inspection,
        absent: inspection.absent,
        modules: [],
        backendDeleted: false,
      })
    }
    async function prepare(deployment: (typeof prepared)[number]) {
      if (deployment.absent || deployment.inspection.backendAbsent) return
      const { context } = deployment
      await unchanged(context.target)
      const names = installationNames(context.config)
      const workspace = await openInstallationWorkspace(
        context.config,
        dirname(context.target.path),
      )
      closes.push(workspace.close)
      const expectedStateLocks = new Map(
        deployment.inspection.stateLocks.map(({ kind, snapshot }) => [kind, snapshot.fingerprint]),
      )
      const checkedInspection = async () => {
        signal?.throwIfAborted()
        await unchanged(context.target)
        await verifyAzureTarget(context.config, execute)
        const inspection = await inspectChecked(context, undefined, {
          collectRetained: true,
          collectStateLocks: true,
        })
        if (
          inspection.stateLocks.some(
            ({ kind, snapshot }) => expectedStateLocks.get(kind) !== snapshot.fingerprint,
          )
        )
          throw new Error(
            "A Terraform state lock changed or a new writer appeared after preflight. No further recovery was attempted.",
          )
        return inspection
      }
      const recovery = await checkedInspection()
      if (recovery.stateLocks.length && recovery.app) {
        changesStarted = true
        ui.status(`Stopping verified Hub before state recovery: ${context.config.name}`)
        await stopHub({
          name: `${context.config.name}-hub`,
          resourceGroup: context.config.azure.resourceGroup,
          command: async (...args) => {
            const result = await context.azure(...args)
            return args[2] === "deactivate" ? result : (JSON.parse(result) as unknown)
          },
        })
      }
      const stage = join(context.directory, `removal-${randomUUID()}`)
      await privateDirectory(stage)
      staging.push(stage)
      for (const lock of recovery.stateLocks) {
        await recoverTerraformState(context, {
          kind: lock.kind,
          expected: lock.snapshot,
          staging: stage,
          verify: async () => (await checkedInspection()).evidence,
        })
      }
      if ((await checkedInspection()).stateLocks.length)
        throw new Error(
          "Terraform state recovery was not verified. No operational lock was cleared.",
        )
      for (const observed of deployment.inspection.retained) {
        await unchanged(context.target)
        const fresh = await checkedInspection()
        const current = fresh.retained.find(
          ({ target }) =>
            target.account === observed.target.account &&
            target.container === observed.target.container &&
            target.blob === observed.target.blob,
        )
        if (!current) continue
        ui.status(
          `Recovering confirmed removal's operational lock: ${current.target.account}/${current.target.container}/${current.target.blob}`,
        )
        await recoverLease(
          context,
          current.target.account,
          current.target.container,
          current.target.blob,
          {
            removalApproved: true,
            onShutdown: () => {
              changesStarted = true
            },
          },
        )
      }
      const strict = { ...context, ui: { ...ui, select: undefined } }
      deployment.lock = await acquireLease(
        strict,
        names.stateAccount,
        "terraform",
        `${context.config.name}/installer.lock`,
      )
      await deployment.lock.verify()
      deployment.inspection = await inspectChecked(context, undefined, { installation: true })
      for (const kind of ["provision", "app", "foundation"] as RemovalModule[]) {
        if (deployment.inspection.states.has(`${context.config.name}/${kind}.tfstate`))
          deployment.modules.push(await prepareRemovalModule(context, kind, stage))
      }
      const resources = deployment.modules.flatMap((module) => module.resources)
      if (new Set(resources.map(({ id }) => id.toLowerCase())).size !== resources.length)
        throw new Error(
          "Terraform modules claim the same resource. Review overlapping state before removal.",
        )
      await deployment.lock.verify()
      deployment.inspection = await inspectChecked(context, resources, { installation: true })
      unchangedStates(deployment.inspection.states, deployment.modules, context.config.name)
      if (deployment.inspection.release)
        deployment.release = await acquireLease(
          strict,
          `${context.config.name.replaceAll("-", "")}hub`,
          "releases",
          "deployment.lock",
        )
      const environment = resources.find(({ type }) => type === "azurerm_container_app_environment")
      deployment.managedGroup = await removalEnvironment(
        context,
        resources,
        environment !== undefined &&
          (deployment.inspection.groups
            .get(context.config.azure.resourceGroup)
            ?.some(
              ({ id }) =>
                typeof id === "string" && id.toLowerCase() === environment.id.toLowerCase(),
            ) ??
            false),
      )
    }
    for (const deployment of prepared) {
      const { context } = deployment
      const { config, azure } = context
      if (deployment.absent) {
        removed.push(`${config.name}: no installation resource groups exist; local files retained`)
        continue
      }
      if (deployment.inspection.backendAbsent) {
        await unchanged(context.target)
        const inspection = await inspectRemoval(context)
        if (!inspection.backendAbsent || inspection.groups.size !== 1)
          throw new Error("The empty state-group scope changed. Removal stopped.")
        const names = installationNames(config)
        changesStarted = true
        await azure("group", "delete", "--name", names.stateGroup, "--yes")
        if (JSON.parse(await azure("group", "exists", "--name", names.stateGroup)) !== false)
          throw new Error("Empty state-group removal was not verified.")
        deployment.backendDeleted = true
        removed.push(`${config.name}: remaining empty state group removed; local files retained`)
        continue
      }
      await prepare(deployment)
      const resources = deployment.modules.flatMap((module) => module.resources)
      const verify = async () => {
        const inspection = await inspectChecked(context, resources, {
          installation: true,
          release: deployment.release?.held,
        })
        unchangedStates(inspection.states, deployment.modules, config.name)
      }
      await verify()
      if (deployment.inspection.app) {
        ui.status(`Stopping Hub for removal: ${config.name}`)
        changesStarted = true
        await stopHub({
          name: `${config.name}-hub`,
          resourceGroup: config.azure.resourceGroup,
          command: async (...args) => {
            const result = await azure(...args)
            return args[2] === "deactivate" ? result : (JSON.parse(result) as unknown)
          },
        })
      }
      for (const module of deployment.modules) {
        await verify()
        ui.status(`Removing ${config.name}: ${module.kind}`)
        if (module.resources.length) changesStarted = true
        if (module.kind === "app" && deployment.release?.held) await deployment.release.deleteBlob()
        await module.destroy()
      }
      for (const module of deployment.modules) await module.empty()
      const names = installationNames(config)
      for (const group of [config.azure.resourceGroup, names.foundationGroup]) {
        const exists: unknown = JSON.parse(await azure("group", "exists", "--name", group))
        if (exists !== false)
          throw new Error(
            "An application or foundation group remains. State storage was preserved for recovery.",
          )
      }
      if (deployment.managedGroup) {
        const deadline = performance.now() + 300_000
        while (true) {
          const exists: unknown = JSON.parse(
            await azure("group", "exists", "--name", deployment.managedGroup),
          )
          if (exists === false) break
          if (exists !== true || performance.now() >= deadline)
            throw new Error(
              "Azure-managed environment cleanup is incomplete. State storage was preserved; do not delete the managed group manually.",
            )
          await delay(5_000, undefined, { signal })
        }
      }
      await verify()
      const existing: unknown = JSON.parse(
        await azure("resource", "list", "--resource-group", names.stateGroup),
      )
      const stateId = `/subscriptions/${config.azure.subscriptionId}/resourceGroups/${names.stateGroup}/providers/Microsoft.Storage/storageAccounts/${names.stateAccount}`
      if (
        !Array.isArray(existing) ||
        existing.length !== 1 ||
        existing[0] === null ||
        typeof existing[0] !== "object" ||
        typeof existing[0].id !== "string" ||
        existing[0].id.toLowerCase() !== stateId.toLowerCase()
      )
        throw new Error("Unexpected state-group resources appeared. Backend deletion stopped.")
      ui.status(`Removing verified empty state backend: ${config.name}`)
      changesStarted = true
      deployment.backendDeletionRequested = true
      await azure(
        "storage",
        "account",
        "delete",
        "--name",
        names.stateAccount,
        "--resource-group",
        names.stateGroup,
        "--yes",
      )
      deployment.backendDeleted = true
      const remaining: unknown = JSON.parse(
        await azure("resource", "list", "--resource-group", names.stateGroup),
      )
      if (!Array.isArray(remaining) || remaining.length)
        throw new Error("The state group is not empty. It was not deleted.")
      await azure("group", "delete", "--name", names.stateGroup, "--yes")
      if (JSON.parse(await azure("group", "exists", "--name", names.stateGroup)) !== false)
        throw new Error("State-group removal was not verified.")
      removed.push(`${config.name}: owned cloud resources removed; local files retained`)
    }
    return `Removal finished.\n${removed.join("\n")}\nPurge-protected vaults and Azure retention may outlast deletion. No backups were created.`
  } catch (error) {
    failed = true
    failureSummary = [
      changesStarted
        ? `Removal stopped. ${removed.length} selected deployment(s) completed; others may be partly removed or unprocessed. Local installation files were retained; cloud resources and state may be partly removed. Review cloud status and the failed operation before retrying.`
        : "Removal stopped before resource deletion or Hub shutdown. No deployment resources were removed or stopped. Local installation files were retained; any acquired cloud leases remain subject to recovery checks.",
      ...removed,
      `Not completed: ${targets
        .slice(removed.length)
        .map(({ config }) => config.name)
        .join(", ")}.`,
    ].join("\n")
    ui.notice?.("error", failureSummary)
    if (
      !recoveryHandled &&
      !signal?.aborted &&
      error instanceof Error &&
      !(error instanceof CommandExecutionError && error.aborted) &&
      !(error instanceof DOMException && error.name === "AbortError")
    ) {
      const displayed =
        error instanceof SyntaxError
          ? new Error("Removal received invalid JSON metadata. The response was not printed.")
          : error
      try {
        await promptForRecovery(ui, {
          error: displayed,
          question: "Removal needs review before continuing.",
          message: failureSummary,
          actions: [],
          details:
            "No destructive retry is available here: changes may be partial, a command result may be unknown, or a safety check may have blocked removal. Review the failed operation and remaining target list. Exit this installer before any authorized retained-lock recovery; never break a lease while this process is active. Original local files are retained. A new removal attempt requires fresh confirmation and exact deployment names.",
        })
      } catch (recoveryError) {
        throw recoveryError === displayed ? error : recoveryError
      }
    }
    throw error
  } finally {
    for (const deployment of prepared) {
      if (deployment.backendDeletionRequested && !deployment.backendDeleted)
        ui.status(
          "State-account deletion was requested but its result is unknown. Do not assume its backend or lease still exists.",
        )
      else if (!deployment.backendDeleted) {
        if (deployment.release?.held) deployment.release.reportRetained()
        deployment.lock?.reportRetained()
      }
    }
    const cleanupFailures: unknown[] = []
    for (const directory of staging) {
      try {
        await rm(directory, { recursive: true, force: true })
      } catch (error) {
        cleanupFailures.push(error)
      }
    }
    for (const close of closes.reverse()) {
      try {
        await close()
      } catch (error) {
        cleanupFailures.push(error)
      }
    }
    if (cleanupFailures.length) {
      ui.notice?.(
        "error",
        [
          failureSummary ?? "Cloud removal finished for the selected deployments.",
          "Removal cleanup did not complete. Review private staging and local writer records before retrying.",
        ].join("\n"),
      )
      if (!failed)
        throw new Error(
          "Removal finished cloud work but local cleanup failed; review local writer records.",
        )
    }
    if (!failed) ui.complete?.()
  }
}

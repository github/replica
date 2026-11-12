import { createHash } from "node:crypto"

import { verifyInstallationGroup } from "../../group/index.ts"
import { installationNames } from "../../settings.ts"
import type { AzureInstallation, RecoveryInspection } from "../../types.ts"
import { readBlobLease } from "../read/index.ts"

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export async function inspectRecovery(
  context: AzureInstallation,
  releaseAccount?: string,
): Promise<RecoveryInspection> {
  const { azure, config, ui } = context
  const names = installationNames(config)
  const blockers: string[] = []
  const hubBlockers: string[] = []
  const evidence: string[] = []
  const fingerprint = () =>
    createHash("sha256").update(JSON.stringify(evidence.sort())).digest("hex")
  let hub: RecoveryInspection["hub"]
  const expected = {
    application: "replica-hub",
    installation: config.name,
    owner: config.owner,
    managed_by: "terraform",
  }
  async function list(...args: string[]): Promise<unknown[]> {
    const value: unknown = JSON.parse(await azure(...args))
    if (!Array.isArray(value))
      throw new Error("Azure did not return a recovery inspection list. No lock was cleared.")
    return value
  }
  async function resourceNames(...args: string[]): Promise<string[]> {
    const values = await list(...args, "--query", "[].name")
    if (!values.every((value): value is string => typeof value === "string" && value.length > 0))
      throw new Error("Azure returned unknown resource names. No lock was cleared.")
    return values
  }

  ui.status("Checking Terraform state locks and installation ownership")
  const prefix = `${config.name}/`
  const states = await list(
    "storage",
    "blob",
    "list",
    "--account-name",
    names.stateAccount,
    "--container-name",
    "terraform",
    "--prefix",
    prefix,
    "--auth-mode",
    "login",
    "--query",
    "[].{name:name,lease:properties.lease}",
  )
  for (const state of states) {
    if (!record(state) || typeof state.name !== "string" || !state.name.startsWith(prefix))
      throw new Error("Azure returned unknown Terraform state metadata. No lock was cleared.")
    if (!state.name.endsWith(".tfstate")) continue
    let lease = state.lease
    if (
      !record(lease) ||
      lease.status !== "unlocked" ||
      typeof lease.state !== "string" ||
      !["available", "broken", "expired"].includes(lease.state)
    )
      lease = await readBlobLease(context, names.stateAccount, "terraform", state.name)
    evidence.push(
      JSON.stringify([
        "state",
        state.name,
        record(lease) && typeof lease.status === "string" ? lease.status : null,
        record(lease) && typeof lease.state === "string" ? lease.state : null,
        record(lease) && typeof lease.duration === "string" ? lease.duration : null,
      ]),
    )
    if (
      !record(lease) ||
      lease.status !== "unlocked" ||
      typeof lease.state !== "string" ||
      !["available", "broken", "expired"].includes(lease.state)
    )
      blockers.push(
        `Terraform state ${state.name} is locked or its status is unknown. Wait for Terraform to finish, or review its recovery separately. The wizard never force-unlocks Terraform state.`,
      )
  }
  const foundationExists = await verifyInstallationGroup(context, names.foundationGroup)
  const databaseReview = await verifyInstallationGroup(context, config.azure.resourceGroup)
  evidence.push(JSON.stringify(["groups", foundationExists, databaseReview]))
  if (!databaseReview) {
    if (releaseAccount)
      blockers.push(
        "The release account has no matching application resource group. Review ownership before clearing this lock.",
      )
    return { blockers, databaseReview, evidence: fingerprint() }
  }
  if (releaseAccount) {
    const tags: unknown = JSON.parse(
      await azure(
        "storage",
        "account",
        "show",
        "--name",
        releaseAccount,
        "--resource-group",
        config.azure.resourceGroup,
        "--query",
        "tags",
      ),
    )
    if (!record(tags) || Object.entries(expected).some(([key, value]) => tags[key] !== value))
      blockers.push(
        "The release storage account does not belong to this installation. Its lock will not be cleared.",
      )
  }

  const group = ["--resource-group", config.azure.resourceGroup]
  ui.status("Checking provisioning/setup executions and Hub revisions")
  for (const job of await resourceNames("containerapp", "job", "list", ...group)) {
    evidence.push(JSON.stringify(["job", job]))
    const executions = await list(
      "containerapp",
      "job",
      "execution",
      "list",
      "--name",
      job,
      ...group,
      "--query",
      "[].{name:name,status:properties.status}",
    )
    for (const execution of executions) {
      if (
        !record(execution) ||
        typeof execution.name !== "string" ||
        !execution.name.length ||
        typeof execution.status !== "string"
      )
        throw new Error("Azure returned unknown job execution metadata. No lock was cleared.")
      if (!["Succeeded", "Failed", "Stopped", "Canceled"].includes(execution.status))
        blockers.push(
          `Job ${job}, execution ${execution.name}, is ${execution.status}. In Azure portal > Container Apps Jobs > ${job} > Execution history, wait for or explicitly stop it before rechecking.`,
        )
      evidence.push(JSON.stringify(["execution", job, execution.name, execution.status]))
    }
  }
  for (const app of await resourceNames("containerapp", "list", ...group)) {
    evidence.push(JSON.stringify(["app", app]))
    const activity: string[] = []
    const revisions = await list(
      "containerapp",
      "revision",
      "list",
      "--name",
      app,
      ...group,
      "--query",
      "[].{name:name,active:properties.active}",
    )
    for (const revision of revisions) {
      if (
        !record(revision) ||
        typeof revision.name !== "string" ||
        !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(revision.name) ||
        typeof revision.active !== "boolean"
      )
        throw new Error("Azure returned unknown revision metadata. No lock was cleared.")
      if (revision.active)
        activity.push(
          `Revision ${revision.name} is active. Hub must enter an approved maintenance window before clearing this lock.`,
        )
      evidence.push(JSON.stringify(["revision", app, revision.name, revision.active]))
      const replicas = await resourceNames(
        "containerapp",
        "replica",
        "list",
        "--name",
        app,
        ...group,
        "--revision",
        revision.name,
      )
      if (replicas.length)
        activity.push(
          `Revision ${revision.name} still has ${replicas.length} replica(s). Wait for every replica to stop, including replicas of inactive revisions, before rechecking.`,
        )
      for (const replica of replicas)
        evidence.push(JSON.stringify(["replica", app, revision.name, replica]))
    }
    if (app === `${config.name}-hub` && !blockers.length) {
      const identity: unknown = JSON.parse(
        await azure(
          "containerapp",
          "show",
          "--name",
          app,
          ...group,
          "--query",
          "{id:id,name:name,tags:tags}",
        ),
      )
      const id = `/subscriptions/${config.azure.subscriptionId}/resourceGroups/${config.azure.resourceGroup}/providers/Microsoft.App/containerApps/${app}`
      const tags = record(identity) ? identity.tags : undefined
      if (
        record(identity) &&
        identity.name === app &&
        typeof identity.id === "string" &&
        identity.id.toLowerCase() === id.toLowerCase() &&
        record(tags) &&
        Object.entries(expected).every(([key, value]) => tags[key] === value)
      ) {
        evidence.push(JSON.stringify(["identity", app, identity.id.toLowerCase()]))
        if (activity.length) {
          hub = { name: app, id: identity.id }
          hubBlockers.push(...activity)
        }
        continue
      }
      blockers.push(
        `Hub app ${app} ownership or resource identity could not be verified. Shutdown must be reviewed manually.`,
      )
    }
    if (!activity.length) continue
    blockers.push(
      ...activity,
      `Automatic shutdown is unavailable for ${app} until ownership, Terraform state, and job safety checks pass. The wizard does not stop unrelated or unverified apps; review those workloads separately.`,
    )
  }
  return {
    blockers: [...blockers, ...hubBlockers],
    databaseReview,
    evidence: fingerprint(),
    ...(!blockers.length && hub ? { hub } : {}),
  }
}

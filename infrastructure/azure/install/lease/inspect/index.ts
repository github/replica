import { verifyInstallationGroup } from "../../group/index.ts"
import { installationNames } from "../../settings.ts"
import type { AzureInstallation } from "../../types.ts"

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export async function inspectRecovery(context: AzureInstallation, releaseAccount?: string) {
  const { azure, config, ui } = context
  const names = installationNames(config)
  const blockers: string[] = []
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
    const lease = state.lease
    if (
      !record(lease) ||
      lease.status !== "unlocked" ||
      !["available", "broken", "expired"].includes(String(lease.state))
    )
      blockers.push(
        `Terraform state ${state.name} is locked or its status is unknown. Wait for Terraform to finish, or review its recovery separately. The wizard never force-unlocks Terraform state.`,
      )
  }
  await verifyInstallationGroup(context, names.foundationGroup)
  const databaseReview = await verifyInstallationGroup(context, config.azure.resourceGroup)
  if (!databaseReview) {
    if (releaseAccount)
      blockers.push(
        "The release account has no matching application resource group. Review ownership before clearing this lock.",
      )
    return { blockers, databaseReview }
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
    const expected = {
      application: "replica-hub",
      installation: config.name,
      owner: config.owner,
      managed_by: "terraform",
    }
    if (!record(tags) || Object.entries(expected).some(([key, value]) => tags[key] !== value))
      blockers.push(
        "The release storage account does not belong to this installation. Its lock will not be cleared.",
      )
  }

  const group = ["--resource-group", config.azure.resourceGroup]
  ui.status("Checking provisioning/setup executions and Hub revisions")
  for (const job of await resourceNames("containerapp", "job", "list", ...group)) {
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
        typeof execution.status !== "string"
      )
        throw new Error("Azure returned unknown job execution metadata. No lock was cleared.")
      if (!["Succeeded", "Failed", "Stopped", "Canceled"].includes(execution.status))
        blockers.push(
          `Job ${job}, execution ${execution.name}, is ${execution.status}. In Azure portal > Container Apps Jobs > ${job} > Execution history, wait for or explicitly stop it before rechecking.`,
        )
    }
  }
  for (const app of await resourceNames("containerapp", "list", ...group)) {
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
        typeof revision.active !== "boolean"
      )
        throw new Error("Azure returned unknown revision metadata. No lock was cleared.")
      if (revision.active)
        blockers.push(
          `Revision ${revision.name} is active. After authorizing a maintenance window, use Azure portal > Container Apps > ${app} > Revisions and replicas to deactivate it. Recovery does not stop Hub automatically.`,
        )
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
        blockers.push(
          `Revision ${revision.name} still has ${replicas.length} replica(s). Wait for every replica to stop, including replicas of inactive revisions, before rechecking.`,
        )
    }
  }
  return { blockers, databaseReview }
}

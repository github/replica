import { createHash } from "node:crypto"
import { installationNames } from "../../install/settings.ts"
import type { RemovalContext, RemovalModule, RemovalResource } from "../types.ts"
import { RemovalLeaseError, type RemovalLeaseTarget } from "../lease-error/index.ts"
import { readBlobLease } from "../../install/lease/read/index.ts"
import { readTerraformLock } from "../read-state-lock/index.ts"
import type { TerraformLockSnapshot } from "../parse-state-lock/index.ts"
import { removalInventory } from "../inventory/index.ts"

export async function inspectRemoval(
  context: RemovalContext,
  resources?: readonly RemovalResource[],
  held: {
    installation?: boolean
    release?: boolean
    collectRetained?: boolean
    collectStateLocks?: boolean
  } = {},
) {
  const { config, azure } = context
  const names = installationNames(config)
  const retained: RemovalLeaseError[] = []
  const stateLocks: { kind: RemovalModule; snapshot: TerraformLockSnapshot }[] = []
  const evidence: string[] = [JSON.stringify(["target", config.azure.subscriptionId, config.name])]
  const fingerprint = () =>
    createHash("sha256").update(JSON.stringify(evidence.sort())).digest("hex")
  function remember(error: RemovalLeaseError) {
    if (
      !retained.some(
        ({ target }) =>
          target.account === error.target.account &&
          target.container === error.target.container &&
          target.blob === error.target.blob,
      )
    )
      retained.push(error)
  }
  const subscription = `/subscriptions/${config.azure.subscriptionId}`
  function invalid(message: string): never {
    throw new Error(`Removal blocked: ${message}. No lock was cleared or ownership bypassed.`)
  }
  function record(value: unknown): Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value))
      invalid("unknown Azure metadata")
    return value as Record<string, unknown>
  }
  async function list(...args: string[]): Promise<Record<string, unknown>[]> {
    const value: unknown = JSON.parse(await azure(...args))
    if (!Array.isArray(value)) invalid("unknown Azure resource list")
    return value.map(record)
  }
  function owned(value: Record<string, unknown>, id: string, installer = false) {
    const tags = record(value.tags)
    if (
      typeof value.id !== "string" ||
      value.id.toLowerCase() !== id.toLowerCase() ||
      Object.entries({
        application: "replica-hub",
        installation: config.name,
        owner: config.owner,
        managed_by: installer ? "replica-installer" : "terraform",
      }).some(([key, expected]) => tags[key] !== expected)
    )
      invalid("resource identity or ownership does not match the selected installation")
  }
  const groups = new Map<string, Record<string, unknown>[]>()
  const untracked: { id: string; type: string; group: string }[] = []
  for (const [group, installer] of [
    [names.stateGroup, true],
    [names.foundationGroup, false],
    [config.azure.resourceGroup, false],
  ] as const) {
    const exists: unknown = JSON.parse(await azure("group", "exists", "--name", group))
    if (typeof exists !== "boolean") invalid("unknown resource group existence")
    if (!exists) continue
    owned(
      record(JSON.parse(await azure("group", "show", "--name", group))),
      `${subscription}/resourceGroups/${group}`,
      installer,
    )
    const resources = await list("resource", "list", "--resource-group", group)
    const groupId = `${subscription}/resourceGroups/${group}`.toLowerCase()
    if (
      resources.some(
        ({ id, type }) =>
          typeof id !== "string" ||
          typeof type !== "string" ||
          !id.toLowerCase().startsWith(`${groupId}/`),
      )
    )
      invalid("resource identity metadata is incomplete")
    groups.set(group, resources)
    evidence.push(
      JSON.stringify([
        "group",
        group.toLowerCase(),
        resources
          .map(({ id, type }) => [
            typeof id === "string" ? id.toLowerCase() : null,
            typeof type === "string" ? type.toLowerCase() : null,
          ])
          .map((value) => JSON.stringify(value))
          .sort(),
      ]),
    )
  }
  const stateResources = groups.get(names.stateGroup)
  const stateId = `${subscription}/resourceGroups/${names.stateGroup}/providers/Microsoft.Storage/storageAccounts/${names.stateAccount}`
  if (!stateResources) {
    if (groups.size) invalid("cloud resources remain but the installation state backend is missing")
    return {
      absent: true as const,
      backendAbsent: true,
      states: new Set<string>(),
      app: false,
      release: false,
      groups,
      untracked,
      retained,
      stateLocks,
      evidence: fingerprint(),
    }
  }
  if (!stateResources.length && groups.size === 1)
    return {
      absent: false as const,
      backendAbsent: true,
      states: new Set<string>(),
      app: false,
      release: false,
      groups,
      untracked,
      retained,
      stateLocks,
      evidence: fingerprint(),
    }
  if (!stateResources.length) invalid("state group is missing its backend")
  owned(
    record(
      JSON.parse(
        await azure(
          "storage",
          "account",
          "show",
          "--name",
          names.stateAccount,
          "--resource-group",
          names.stateGroup,
        ),
      ),
    ),
    stateId,
    true,
  )
  if (
    !stateResources.some(
      ({ id }) => typeof id === "string" && id.toLowerCase() === stateId.toLowerCase(),
    )
  )
    invalid("state group contains another resource")
  for (const value of stateResources) {
    if (String(value.id).toLowerCase() !== stateId.toLowerCase())
      untracked.push({
        id: String(value.id),
        type: String(value.type),
        group: names.stateGroup,
      })
  }
  const containers: unknown = JSON.parse(
    await azure(
      "storage",
      "container",
      "list",
      "--account-name",
      names.stateAccount,
      "--auth-mode",
      "login",
      "--num-results",
      "*",
      "--include-deleted",
      "--query",
      "[].name",
    ),
  )
  if (!Array.isArray(containers) || containers.length !== 1 || containers[0] !== "terraform")
    invalid("state account contains missing or unexpected containers")
  const states = new Set<string>()
  const leases = new Map<string, Record<string, unknown>>()
  async function currentLease(target: RemovalLeaseTarget): Promise<Record<string, unknown>> {
    const key = `${target.account}/${target.container}/${target.blob}`
    const cached = leases.get(key)
    if (cached) return cached
    let value: unknown
    try {
      value = await readBlobLease(context, target.account, target.container, target.blob)
    } catch (error) {
      if (error instanceof SyntaxError) throw new RemovalLeaseError(target, undefined)
      throw error
    }
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new RemovalLeaseError(target, value)
    const metadata = value as Record<string, unknown>
    leases.set(key, metadata)
    return metadata
  }
  for (const blob of await list(
    "storage",
    "blob",
    "list",
    "--account-name",
    names.stateAccount,
    "--container-name",
    "terraform",
    "--auth-mode",
    "login",
    "--num-results",
    "*",
    "--include",
    "dsv",
    "--query",
    "[].{name:name,lease:properties.lease,version:versionId,current:isCurrentVersion,snapshot:snapshot,deleted:deleted,etag:properties.etag,modified:properties.lastModified}",
  )) {
    if (
      typeof blob.name !== "string" ||
      !["app.tfstate", "foundation.tfstate", "provision.tfstate", "installer.lock"].some(
        (suffix) => blob.name === `${config.name}/${suffix}`,
      )
    )
      invalid("state backend contains another installation or unexpected blobs")
    if (blob.current !== undefined && blob.current !== null && typeof blob.current !== "boolean")
      invalid("unknown state version metadata")
    if (
      blob.deleted === true ||
      blob.current === false ||
      (typeof blob.snapshot === "string" && blob.snapshot !== "")
    )
      continue
    const coordinates = {
      installation: config.name,
      subscription: config.azure.subscriptionId,
      kind: blob.name.endsWith(".tfstate") ? ("terraform" as const) : ("installation" as const),
      account: names.stateAccount,
      container: "terraform",
      blob: blob.name,
    }
    let lease = blob.lease
    const known =
      lease !== null && typeof lease === "object" && !Array.isArray(lease)
        ? (lease as Record<string, unknown>)
        : undefined
    if (
      coordinates.kind === "installation" ||
      !known ||
      known.status !== "unlocked" ||
      typeof known.state !== "string" ||
      !["available", "broken", "expired"].includes(known.state)
    ) {
      lease = await currentLease(coordinates)
    }
    if (!lease || typeof lease !== "object" || Array.isArray(lease))
      throw new RemovalLeaseError(coordinates, lease)
    const metadata = lease as Record<string, unknown>
    evidence.push(
      JSON.stringify([
        "state",
        blob.name,
        metadata.status,
        metadata.state,
        metadata.duration,
        blob.version ?? null,
        blob.etag ?? null,
        blob.modified ?? null,
      ]),
    )
    if (blob.name === `${config.name}/installer.lock` && held.installation) {
      if (
        metadata.status !== "locked" ||
        metadata.state !== "leased" ||
        metadata.duration !== "infinite"
      )
        throw new RemovalLeaseError(coordinates, metadata)
      states.add(blob.name)
      continue
    }
    if (
      metadata.status !== "unlocked" ||
      typeof metadata.state !== "string" ||
      !["available", "broken", "expired"].includes(metadata.state)
    ) {
      const error = new RemovalLeaseError(coordinates, metadata)
      if (held.collectRetained && error.knownRetained) remember(error)
      else if (
        held.collectStateLocks &&
        coordinates.kind === "terraform" &&
        metadata.status === "locked" &&
        metadata.state === "leased" &&
        metadata.duration === "infinite"
      ) {
        const kind = (["provision", "app", "foundation"] as const).find(
          (kind) => blob.name === `${config.name}/${kind}.tfstate`,
        )
        if (!kind) throw error
        if (!stateLocks.some((lock) => lock.kind === kind)) {
          const snapshot = await readTerraformLock(context, kind)
          if (snapshot) {
            stateLocks.push({ kind, snapshot })
            evidence.push(JSON.stringify(["state-lock", kind, snapshot.fingerprint]))
          }
        }
      } else throw error
    }
    states.add(blob.name)
  }
  if (!states.has(`${config.name}/installer.lock`))
    invalid("installation lock is missing; review the interrupted bootstrap")
  if (resources) {
    untracked.splice(0, untracked.length, ...(await removalInventory(context, resources, groups)))
  }
  let app = false
  let release = false
  if (groups.has(config.azure.resourceGroup)) {
    for (const job of await list(
      "containerapp",
      "job",
      "list",
      "--resource-group",
      config.azure.resourceGroup,
    )) {
      if (typeof job.name !== "string") invalid("unknown job identity")
      if (![`${config.name}-setup`, `${config.name}-provision`].includes(job.name)) continue
      evidence.push(JSON.stringify(["job", job.name]))
      for (const execution of await list(
        "containerapp",
        "job",
        "execution",
        "list",
        "--name",
        job.name,
        "--resource-group",
        config.azure.resourceGroup,
        "--query",
        "[].{name:name,status:properties.status}",
      )) {
        evidence.push(JSON.stringify(["execution", job.name, execution.name, execution.status]))
        if (
          typeof execution.name !== "string" ||
          !execution.name ||
          !["Succeeded", "Failed", "Stopped", "Canceled"].includes(String(execution.status))
        )
          invalid("a job execution is active or unknown; stop and review it first")
      }
    }
    for (const value of await list(
      "containerapp",
      "list",
      "--resource-group",
      config.azure.resourceGroup,
    )) {
      const id = `${subscription}/resourceGroups/${config.azure.resourceGroup}/providers/Microsoft.App/containerApps/${config.name}-hub`
      if (typeof value.id !== "string") invalid("unknown app identity")
      if (value.id.toLowerCase() !== id.toLowerCase()) continue
      owned(value, id)
      evidence.push(JSON.stringify(["app", id.toLowerCase()]))
      app = true
    }
    const storage = groups
      .get(config.azure.resourceGroup)!
      .find(
        (value) =>
          typeof value.type === "string" &&
          value.type.toLowerCase() === "microsoft.storage/storageaccounts" &&
          typeof value.id === "string" &&
          value.id.toLowerCase().endsWith(`/storageaccounts/${config.name.replaceAll("-", "")}hub`),
      )
    if (storage) {
      const account = `${config.name.replaceAll("-", "")}hub`
      const id = `${subscription}/resourceGroups/${config.azure.resourceGroup}/providers/Microsoft.Storage/storageAccounts/${account}`
      owned(
        record(
          JSON.parse(
            await azure(
              "storage",
              "account",
              "show",
              "--name",
              account,
              "--resource-group",
              config.azure.resourceGroup,
            ),
          ),
        ),
        id,
      )
      const exists = record(
        JSON.parse(
          await azure(
            "storage",
            "blob",
            "exists",
            "--account-name",
            account,
            "--container-name",
            "releases",
            "--name",
            "deployment.lock",
            "--auth-mode",
            "login",
          ),
        ),
      )
      if (typeof exists.exists !== "boolean") invalid("unknown release lock existence")
      if (exists.exists) {
        const coordinates = {
          installation: config.name,
          subscription: config.azure.subscriptionId,
          kind: "release" as const,
          account,
          container: "releases",
          blob: "deployment.lock",
        }
        const lease = await currentLease(coordinates)
        evidence.push(
          JSON.stringify(["release", account, lease.status, lease.state, lease.duration]),
        )
        if (
          held.release
            ? lease.status !== "locked" || lease.state !== "leased" || lease.duration !== "infinite"
            : lease.status !== "unlocked" ||
              typeof lease.state !== "string" ||
              !["available", "broken", "expired"].includes(lease.state)
        ) {
          const error = new RemovalLeaseError(coordinates, lease)
          if (!held.release && held.collectRetained && error.knownRetained) remember(error)
          else throw error
        }
        release = true
      }
    }
  }
  return {
    absent: false as const,
    backendAbsent: false,
    states,
    app,
    release,
    groups,
    untracked,
    retained,
    stateLocks,
    evidence: fingerprint(),
  }
}

import { join, resolve } from "node:path"

import { writePrivateFile } from "../../../installer/private-files/index.ts"
import { terraformModule } from "../../../terraform/index.ts"
import { writeBackendFile } from "../backend/index.ts"
import { existingRoleAssignment } from "../existing-role-assignment/index.ts"
import { acquireLease } from "../lease/index.ts"
import { installationNames } from "../settings.ts"
import type { AzureInstallation, Foundation, Installation } from "../types.ts"
import {
  dnsRecordsReady,
  formatDnsRecords,
  readerDnsRecords,
  systemResolver,
  type DnsResolver,
} from "./dns/index.ts"
import { verifyPreviewGrants } from "./grants/index.ts"
import {
  checkPrivatePreviewChoice,
  hubOrigin,
  hubPreviewInputs,
  hubTrustedProxyHops,
  type HubPreviewInputs,
} from "./hub-environment/index.ts"
import { allowedPreviewDeletion, validatePrivatePreviewPlan } from "./plan/index.ts"
import {
  expandVariables,
  needsPreviewRoot,
  offChoice,
  readPreviewState,
  sameVariables,
  targetVariables,
  type PreviewVariables,
} from "./settings/index.ts"
import { guardPreviewState } from "./state-guard/index.ts"

type SecretReference = { key_vault_id: string; secret_id: string }
type ReaderOutput = {
  origin: string | null
  generated_hostname: string | null
  custom_domain_verification_id: string | null
}

const guid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

/*
 * Runs before the Hub release. It applies everything Hub may still use (expand), and returns the
 * Hub settings for the release. finish() then removes what the new Hub no longer uses (contract).
 */
export async function preparePrivatePreview<T extends HubPreviewInputs>(
  context: AzureInstallation,
  {
    image,
    foundation,
    installation,
    inputs,
    readerSecret,
    lock,
    resolver = systemResolver,
  }: {
    image: string
    foundation: Foundation
    installation: Installation
    inputs: T
    readerSecret(): Promise<SecretReference>
    lock: { verify(): Promise<void> }
    resolver?: DnsResolver
  },
): Promise<{ inputs: T; finish(): Promise<string[]> }> {
  const { config, directory, run, ui, signal } = context
  const choice = config.privatePreview ?? offChoice
  const { subscriptionId } = config.azure
  const names = installationNames(config)
  const previewName = `${config.name}-preview`
  const previewGroupId = `/subscriptions/${subscriptionId}/resourceGroups/${previewName}`
  const environmentId = `${previewGroupId}/providers/Microsoft.App/managedEnvironments/${previewName}-environment`
  const readerIdentityId = `${previewGroupId}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/${previewName}`
  const containerId = `${installation.storage_account_id}/blobServices/default/containers/private-preview-artifacts`
  const read = async (...args: string[]): Promise<unknown> => JSON.parse(await context.azure(...args))
  const block = (reason: string): never => {
    throw new Error(`Private preview blocked: ${reason}`)
  }
  const stateTarget = {
    account: names.stateAccount,
    container: "terraform",
    key: `${config.name}/private-preview.tfstate`,
  }
  const resourcesExist = async () =>
    (await read("group", "exists", "--name", previewName)) === true ||
    ((await read(
      "storage", "container-rm", "exists", "--storage-account", installation.storage_account_id,
      "--name", "private-preview-artifacts",
    )) as { exists?: unknown }).exists !== false
  const stateBlob = (await read(
    "storage", "blob", "exists", "--account-name", stateTarget.account, "--container-name",
    stateTarget.container, "--name", stateTarget.key, "--auth-mode", "login",
  )) as { exists?: unknown }
  if (typeof stateBlob.exists !== "boolean") block("Azure did not confirm whether saved private preview state exists.")
  if (!needsPreviewRoot(choice, stateBlob.exists === true)) {
    if (await resourcesExist())
      block(
        `saved state ${stateTarget.key} is missing, but private preview resources exist. Restore the state from a blob version before retrying. No changes were made.`,
      )
    return { inputs: hubPreviewInputs(inputs, { writerRepositoryIds: [] }), finish: async () => [] }
  }

  const origin = hubOrigin(inputs)
  const hops = hubTrustedProxyHops(inputs)
  checkPrivatePreviewChoice(choice, inputs)

  const guard = await guardPreviewState({ azure: context.azure, directory, target: stateTarget, resourcesExist })
  let releaseLock: Awaited<ReturnType<typeof acquireLease>> | undefined
  const terraform = terraformModule({
    directory: resolve(import.meta.dirname, "../../private-preview"),
    dataDirectory: join(directory, "terraform", "private-preview"),
    run,
    ui,
    env: context.env,
    signal,
    preapproved: true,
    validatePlan: validatePrivatePreviewPlan,
    allowDeletion: allowedPreviewDeletion,
    findUntracked: existingRoleAssignment(context.azure, subscriptionId),
    requireUntrackedCheck: true,
    beforeApply: async () => {
      guard.verify(await terraform.rawState())
      await lock.verify()
      await releaseLock?.verify()
    },
  })
  await terraform.init(await writeBackendFile(context, "private-preview"))
  guard.verify(await terraform.rawState())
  const current = readPreviewState(await terraform.stateSnapshot())
  const output = () => terraform.output<ReaderOutput>("reader")

  const hubPrincipalId = await read(
    "identity", "show", "--ids", `/subscriptions/${subscriptionId}/resourceGroups/${config.azure.resourceGroup}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/${config.name}-hub`,
    "--query", "principalId",
  )
  if (typeof hubPrincipalId !== "string" || !guid.test(hubPrincipalId)) return block("Hub's identity could not be verified.")

  const recordsFor = (reader: ReaderOutput) =>
    choice.hostname && reader.generated_hostname && reader.custom_domain_verification_id
      ? readerDnsRecords(choice.hostname, reader.generated_hostname, reader.custom_domain_verification_id)
      : undefined
  const knownRecords =
    choice.reader === "on" && choice.hostname && current.reader === "enabled" &&
    current.boundHostname !== choice.hostname
      ? recordsFor(await output())
      : undefined
  const dnsReady = knownRecords ? await dnsRecordsReady(knownRecords, resolver) : false
  const target = targetVariables(choice, current, { dnsReady })
  const hubUsesReader = inputs.runtime_environment_variables?.HUB_PRIVATE_PREVIEW_ENABLED === "true"
  const expand = expandVariables(current, target, { hubUsesReader })
  // The running Hub keeps calling the reader with the settings it was released with.
  const expandHub =
    hubUsesReader && current.reader === "enabled" && current.hubOrigin && current.hops
      ? { origin: current.hubOrigin, hops: current.hops }
      : { origin, hops }

  let secret: SecretReference | undefined
  const variablesFile = join(directory, "private-preview.tfvars.json")
  const bindCertificate = async (hostname: string) => {
    const list = async () => {
      const hosts = await read(
        "containerapp", "hostname", "list", "--name", previewName, "--resource-group", previewName,
        "--query", "[].{name:name,bindingType:bindingType}",
      )
      return Array.isArray(hosts) ? (hosts as { name?: unknown; bindingType?: unknown }[]) : []
    }
    const binding = async () => (await list()).find(({ name }) => name === hostname)?.bindingType
    if ((await binding()) === "SniEnabled") return true
    try {
      // Azure issues a managed certificate after it validates the CNAME and TXT records.
      await context.azure(
        "containerapp", "hostname", "bind", "--hostname", hostname, "--name", previewName,
        "--resource-group", previewName, "--environment", environmentId, "--validation-method", "CNAME",
      )
    } catch (error) {
      if (signal?.aborted) throw error
      ui.notice?.(
        "warning",
        `Azure has not issued the certificate for ${hostname} yet. Hub playback stays off. Check the DNS records, then run Update again.`,
      )
      return false
    }
    if ((await binding()) === "SniEnabled") return true
    ui.notice?.(
      "warning",
      `Azure accepted ${hostname} but has not bound its certificate yet. Hub playback stays off. Run Update again later.`,
    )
    return false
  }
  const expectedGrants = (variables: PreviewVariables, readerPrincipalId: string) => ({
    subscriptionId,
    reader: variables.reader,
    readerPrincipalId,
    hubPrincipalId,
    writer: variables.writer,
    writerRole: `Replica ${config.name} private preview writer`,
    acrId: foundation.registry_id,
    containerId,
    ...(secret && { secretScope: `${secret.key_vault_id}/secrets/${secret.secret_id.split("/")[4]}` }),
  })
  const readerPrincipal = async () => {
    const id = await read("identity", "show", "--ids", readerIdentityId, "--query", "principalId")
    return typeof id === "string" && guid.test(id) ? id : block("the reader identity could not be verified.")
  }
  const applyVariables = async (variables: PreviewVariables, hub = { origin, hops }) => {
    if (variables.reader === "enabled") secret ??= await readerSecret()
    await writePrivateFile(variablesFile, JSON.stringify({
      subscription_id: subscriptionId,
      resource_group_name: config.azure.resourceGroup,
      location: config.azure.location,
      name: config.name,
      owner: config.owner,
      acr_id: foundation.registry_id,
      registry_server: foundation.registry_url,
      storage_account_id: installation.storage_account_id,
      image,
      reader: variables.reader,
      inline_enabled: variables.inline_enabled,
      hub_application_origin: variables.reader === "enabled" ? hub.origin : null,
      trusted_proxy_hops: variables.reader === "enabled" ? hub.hops : null,
      custom_hostname: variables.custom_hostname,
      bind_custom_hostname: variables.bind_custom_hostname,
      reader_secret: variables.reader === "enabled" ? secret : null,
      writer_principal_id: variables.writer ? hubPrincipalId : null,
    }))
    signal?.throwIfAborted()
    releaseLock = await acquireLease(
      context, installation.storage_account, "releases", "deployment.lock", false,
      { operation: "private-preview" },
    )
    try {
      await terraform.apply(variablesFile)
      guard.verify(await terraform.rawState())
      const bound = variables.bind_custom_hostname && variables.custom_hostname
        ? await bindCertificate(variables.custom_hostname)
        : false
      const problems = await verifyPreviewGrants(read, expectedGrants(variables, await readerPrincipal()))
      if (problems.length) block(`${problems.join("\n")}\nReview access before retrying; the release lock is kept.`)
      await releaseLock.release()
      return { bound }
    } finally {
      releaseLock.reportRetained()
    }
  }

  ui.status("Preparing the private prototype service")
  if (expand.reader === "enabled") secret ??= await readerSecret()
  // Stop before any change on grants the wizard did not make, such as hand-made pilot access.
  if (current.reader !== "absent" || current.writer) {
    const problems = await verifyPreviewGrants(
      read, expectedGrants(expand, await readerPrincipal()), { unexpectedOnly: true },
    )
    if (problems.length) block(`${problems.join("\n")}\nRemove or review that access before retrying. No changes were made.`)
  }
  const { bound } = await applyVariables(expand, expandHub)
  const notes: string[] = []
  let playback: { origin: string; inline: boolean } | undefined
  if (target.reader === "enabled") {
    const reader = await output()
    const records = recordsFor(reader)
    const readerOrigin = reader.origin ?? block("Terraform did not report the reader origin.")
    const status = (await read(
      "containerapp", "show", "--name", previewName, "--resource-group", previewName,
      "--query", "{latest:properties.latestRevisionName,ready:properties.latestReadyRevisionName}",
    )) as { latest?: unknown; ready?: unknown }
    const ready = typeof status.latest === "string" && status.latest === status.ready
    const boundNow = bound || current.boundHostname === choice.hostname
    const targetOrigin = choice.hostname ? `https://${choice.hostname}` : `https://${reader.generated_hostname}`
    if (choice.hostname && !boundNow && !target.bind_custom_hostname && records) {
      const message = `Add these DNS records for ${choice.hostname}, then run Update again. Hub playback stays off until Azure binds the certificate.\n${formatDnsRecords(records)}`
      notes.push(message)
      ui.notice?.("warning", message)
    } else if (
      readerOrigin !== targetOrigin || (choice.hostname && !boundNow) ||
      expandHub.origin !== origin || expandHub.hops !== hops
    ) {
      notes.push(
        target.bind_custom_hostname && expand.bind_custom_hostname
          ? `The certificate for ${choice.hostname} is not bound yet. Hub playback stays off; run Update again later.`
          : `The reader moves to ${targetOrigin} after this release. Hub playback stays off; run Update again to turn it on.`,
      )
    } else if (!ready) {
      notes.push("The reader revision is not ready yet. Hub playback stays off; run Update again to recheck.")
    } else {
      playback = { origin: readerOrigin, inline: target.inline_enabled }
      notes.push(`Private prototype service: ${readerOrigin}${target.inline_enabled ? " (new tab and inline)" : " (new tab)"}.`)
    }
  }
  if (target.writer) notes.push(`Private preview publishing is on for repositories ${choice.writerRepositoryIds.join(", ")}.`)
  return {
    inputs: hubPreviewInputs(inputs, {
      ...(playback && { playback, readerSecret: secret }),
      writerRepositoryIds: target.writer ? choice.writerRepositoryIds : [],
    }),
    async finish() {
      if (!sameVariables(expand, target) || expandHub.origin !== origin || expandHub.hops !== hops) {
        ui.status("Removing private prototype service access that Hub no longer uses")
        await applyVariables(target)
      }
      return notes
    },
  }
}

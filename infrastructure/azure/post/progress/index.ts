import { join, isAbsolute } from "node:path"
import { createHash } from "node:crypto"

import { parseHttpsOrigin } from "../../../installer/config/https-origin/index.ts"
import { readPrivateFile, writePrivateFile } from "../../../installer/private-files/index.ts"
import { promptForRecovery } from "../../../installer/prompt-for-recovery/index.ts"
import type { AzureInstallation } from "../../install/types.ts"
import type { PostInputs } from "../types.ts"
import { installationNames } from "../../install/settings.ts"

const publicAnswers = [
  "origin",
  "proxyHops",
  "github_app_id",
  "github_client_id",
  "github_app_installation_id",
  "github_provider_revision",
] as const
const credentialKeys = [
  "GITHUB_CLIENT_SECRET",
  "GITHUB_APP_PRIVATE_KEY_BASE64",
  "GITHUB_WEBHOOK_SECRET",
] as const
const sharedKeys = ["HUB_AUTHENTICATION_ENCRYPTION_KEY", "HUB_BOOTSTRAP_SECRET"] as const
type Reference = NonNullable<PostInputs["runtime_secret_references"]>[string]

interface Progress {
  version: 1
  target: string
  action: "sign-in" | "github"
  answers: Record<string, string>
  references: Record<string, Reference>
  pending?: string
  complete: boolean
  inputs: string
  secretOrigin?: {
    inputs: string
    normalizedInputs?: string
    references: Record<string, Reference>
  }
}

export async function postSetupProgress(
  context: Pick<AzureInstallation, "config" | "directory" | "ui" | "signal">,
  action: "sign-in" | "github",
  inputs?: PostInputs,
  verifiedImage?: string,
) {
  const path = join(context.directory, `post-${action}-progress.json`)
  const target = JSON.stringify(context.config)
  const names = installationNames(context.config)
  const vaultId = `/subscriptions/${context.config.azure.subscriptionId}/resourceGroups/${names.foundationGroup}/providers/Microsoft.KeyVault/vaults/${names.vault}`
  let original = await readPrivateFile(path, { createDirectory: false })
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(inputs ?? {}))
    .digest("hex")
  function retainedFingerprint(value: PostInputs | undefined) {
    const { runtime_environment_variables, runtime_secret_references, ...retained } = value ?? {}
    const { HUB_TRUSTED_PROXY_HOPS, ...environment } = runtime_environment_variables ?? {}
    return createHash("sha256")
      .update(JSON.stringify({ ...retained, runtime_environment_variables: environment }))
      .digest("hex")
  }
  const empty = (): Progress => ({
    version: 1,
    target,
    action,
    inputs: fingerprint,
    answers: {},
    references: {},
    complete: false,
    ...(action === "sign-in" &&
      inputs?.runtime_secret_references?.HUB_APPLICATION_ORIGIN && {
        secretOrigin: {
          inputs: retainedFingerprint(inputs),
          ...(verifiedImage && {
            normalizedInputs: retainedFingerprint({
              ...inputs,
              image: verifiedImage,
              deploy_hub: true,
            }),
          }),
          references: Object.fromEntries(
            Object.entries(inputs.runtime_secret_references).map(([key, value]) => [
              key,
              reference(key, value, true),
            ]),
          ),
        },
      }),
  })
  function invalid(): never {
    throw new Error(
      "Post-setup answers are invalid or belong to another installation/action. The private progress file was preserved.",
    )
  }
  function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) invalid()
    return value as Record<string, unknown>
  }
  const keys: readonly string[] = action === "github" ? credentialKeys : sharedKeys
  const pinned = (secretId: string) =>
    /\/secrets\/[a-z0-9-]{1,127}\/[a-f0-9]{32}$/i.test(secretId)
  function answer(key: string, value: unknown): string {
    if (typeof value !== "string" || value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value))
      invalid()
    if (publicAnswers.includes(key as (typeof publicAnswers)[number])) {
      if (action === "sign-in" && !["origin", "proxyHops"].includes(key)) invalid()
      if (action === "github" && ["origin", "proxyHops"].includes(key)) invalid()
      if (key === "origin") {
        if (!parseHttpsOrigin(value)) invalid()
      } else if (key === "proxyHops") {
        if (!/^(?:[0-9]|10)$/.test(value)) invalid()
      } else if (key === "github_client_id") {
        if (!/^\S{1,200}$/.test(value)) invalid()
      } else if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) invalid()
    } else if (
      !credentialKeys.some((name) => key === `${name}_FILE`) ||
      action !== "github" ||
      (value !== "" && !isAbsolute(value))
    )
      invalid()
    return value
  }
  function reference(key: string, value: unknown, retained = false): Reference {
    if (retained ? !/^[A-Z][A-Z0-9_]{0,40}$/.test(key) : !keys.includes(key)) invalid()
    const raw = record(value)
    if (
      Object.keys(raw).some((key) => !["key_vault_id", "secret_id"].includes(key)) ||
      typeof raw.key_vault_id !== "string" ||
      typeof raw.secret_id !== "string" ||
      (!retained && raw.key_vault_id.toLowerCase() !== vaultId.toLowerCase()) ||
      !/^\/subscriptions\/[a-f0-9-]{36}\/resourceGroups\/[^/]+\/providers\/Microsoft.KeyVault\/vaults\/[a-z0-9-]{1,24}$/i.test(
        raw.key_vault_id,
      ) ||
      !/^https:\/\/[a-z0-9-]{1,24}\.vault\.azure\.net\/secrets\/[a-z0-9-]{1,127}(\/[a-f0-9]{32})?$/i.test(
        raw.secret_id,
      ) ||
      (!retained && !pinned(raw.secret_id)) ||
      new URL(raw.secret_id).hostname.toLowerCase() !==
        `${raw.key_vault_id.split("/").at(-1)?.toLowerCase()}.vault.azure.net`
    )
      invalid()
    return { key_vault_id: raw.key_vault_id, secret_id: raw.secret_id }
  }
  let data = empty()
  if (original !== undefined) {
    let value: unknown
    try {
      value = JSON.parse(original)
    } catch {
      invalid()
    }
    const raw = record(value)
    if (
      raw.version !== 1 ||
      raw.target !== target ||
      raw.action !== action ||
      typeof raw.complete !== "boolean" ||
      typeof raw.inputs !== "string" ||
      !/^[a-f0-9]{64}$/.test(raw.inputs) ||
      Object.keys(raw).some(
        (key) =>
          ![
            "version",
            "target",
            "action",
            "inputs",
            "answers",
            "references",
            "pending",
            "complete",
            "secretOrigin",
          ].includes(key),
      ) ||
      (raw.pending !== undefined &&
        (typeof raw.pending !== "string" || !keys.includes(raw.pending)))
    )
      invalid()
    let secretOrigin: Progress["secretOrigin"]
    if (raw.secretOrigin !== undefined) {
      const saved = record(raw.secretOrigin)
      if (
        action !== "sign-in" ||
        Object.keys(saved).some(
          (key) => !["inputs", "normalizedInputs", "references"].includes(key),
        ) ||
        typeof saved.inputs !== "string" ||
        !/^[a-f0-9]{64}$/.test(saved.inputs) ||
        (saved.normalizedInputs !== undefined &&
          (typeof saved.normalizedInputs !== "string" ||
            !/^[a-f0-9]{64}$/.test(saved.normalizedInputs)))
      )
        invalid()
      secretOrigin = {
        inputs: saved.inputs,
        ...(typeof saved.normalizedInputs === "string" && {
          normalizedInputs: saved.normalizedInputs,
        }),
        references: Object.fromEntries(
          Object.entries(record(saved.references)).map(([key, value]) => [
            key,
            reference(key, value, true),
          ]),
        ),
      }
      if (!secretOrigin.references.HUB_APPLICATION_ORIGIN) invalid()
    }
    data = {
      version: 1,
      target,
      action,
      inputs: raw.inputs,
      complete: raw.complete,
      answers: Object.fromEntries(
        Object.entries(record(raw.answers)).map(([key, value]) => [key, answer(key, value)]),
      ),
      references: Object.fromEntries(
        Object.entries(record(raw.references)).map(([key, value]) => [key, reference(key, value)]),
      ),
      ...(raw.pending !== undefined && { pending: String(raw.pending) }),
      ...(secretOrigin && { secretOrigin }),
    }
    if (data.complete) data = empty()
    else if (data.inputs !== fingerprint) {
      const desired = {
        origin:
          inputs?.hub_application_origin ??
          inputs?.runtime_environment_variables?.HUB_APPLICATION_ORIGIN,
        proxyHops: inputs?.runtime_environment_variables?.HUB_TRUSTED_PROXY_HOPS,
        github_app_id: inputs?.github_app_id,
        github_client_id: inputs?.github_client_id,
        github_app_installation_id: inputs?.github_app_installation_id,
        github_provider_revision: inputs?.github_provider_revision,
      }
      const retainedReferences = { ...data.secretOrigin?.references, ...data.references }
      const currentReferences = inputs?.runtime_secret_references ?? {}
      const secretOriginMatches =
        desired.origin === undefined &&
        (data.secretOrigin?.inputs === retainedFingerprint(inputs) ||
          (verifiedImage !== undefined &&
            inputs?.image === verifiedImage &&
            inputs.deploy_hub === true &&
            data.secretOrigin?.normalizedInputs === retainedFingerprint(inputs))) &&
        Object.keys(retainedReferences).length === Object.keys(currentReferences).length &&
        Object.entries(retainedReferences).every(([key, saved]) => {
          const current = currentReferences[key]
          if (!current) return false
          const checked = reference(key, current, true)
          return (
            checked.key_vault_id.toLowerCase() === saved.key_vault_id.toLowerCase() &&
            (checked.secret_id.toLowerCase() === saved.secret_id.toLowerCase() ||
              ((key === "HUB_APPLICATION_ORIGIN" || sharedKeys.some((name) => name === key)) &&
                !pinned(saved.secret_id) &&
                checked.secret_id.toLowerCase().replace(/\/[a-f0-9]{32}$/i, "") ===
                  saved.secret_id.toLowerCase()))
          )
        })
      if (
        data.pending === undefined &&
        (!data.secretOrigin ||
          (data.answers.origin !== undefined &&
            data.answers.proxyHops !== undefined &&
            secretOriginMatches)) &&
        Object.entries(data.answers).every(
          ([key, value]) =>
            key.endsWith("_FILE") ||
            (key === "origin" && data.secretOrigin
              ? secretOriginMatches
              : String(desired[key as keyof typeof desired]) === value),
        ) &&
        Object.entries(data.references).every(
          ([key, ref]) =>
            JSON.stringify(inputs?.runtime_secret_references?.[key]) === JSON.stringify(ref),
        )
      )
        data = empty()
      else
        throw new Error(
          "Saved deployment inputs changed since these post-setup answers were collected. Review the desired inputs and private progress together before resuming; neither was overwritten.",
        )
    }
  }
  async function save(next: Progress) {
    let recovering = false
    while (true) {
      context.signal?.throwIfAborted()
      if ((await readPrivateFile(path, { createDirectory: false })) !== original)
        throw new Error(
          "Post-setup progress changed in another process. Existing answers were not overwritten.",
        )
      const content = JSON.stringify(next)
      try {
        await writePrivateFile(path, content, { exclusive: original === undefined })
        original = content
        data = next
        if (recovering) context.ui.recoveryNotice?.()
        return
      } catch (error) {
        context.signal?.throwIfAborted()
        if (!(error instanceof Error)) throw error
        recovering = true
        await promptForRecovery(context.ui, {
          error,
          question: "Save post-setup answers before continuing.",
          message:
            "Repair the private progress-file permissions or disk space, then retry saving the same answers. No later cloud step will start while saving is blocked.",
          actions: [{ label: "Retry saving answers", value: "retry" }],
        })
      }
    }
  }
  const hasSaved = () =>
    !data.complete &&
    (Object.keys(data.answers).length > 0 ||
      Object.keys(data.references).length > 0 ||
      data.pending !== undefined)
  return {
    path,
    get hasSaved() {
      return hasSaved()
    },
    get complete() {
      return data.complete
    },
    get answers() {
      return { ...data.answers }
    },
    get references() {
      return structuredClone(data.references)
    },
    get pending() {
      return data.pending
    },
    async saveAnswer(key: string, value: string) {
      const checked = answer(key, value)
      if (data.answers[key] === checked && !data.complete) return
      await save({ ...data, complete: false, answers: { ...data.answers, [key]: checked } })
    },
    async saveReference(key: string, value: Reference) {
      const checked = reference(key, value)
      await save({
        ...data,
        complete: false,
        references: { ...data.references, [key]: checked },
        ...(data.pending === key ? { pending: undefined } : {}),
      })
    },
    async pendingUpload(key: string) {
      if (!keys.includes(key)) invalid()
      if (data.pending && data.pending !== key)
        throw new Error(
          "A different secret write has an unknown outcome. Resolve that pending write before storing another credential; its evidence was preserved.",
        )
      await save({ ...data, complete: false, pending: key })
    },
    async startOver() {
      // Confirmed remote writes remain evidence, even when the operator re-enters public answers.
      await save({ ...data, answers: {}, complete: false })
    },
    async finish() {
      if (data.pending)
        throw new Error(
          "A secret write still has an unknown outcome. Resolve it before completing post-setup; its evidence was preserved.",
        )
      await save({ ...data, complete: true, answers: {} })
    },
  }
}

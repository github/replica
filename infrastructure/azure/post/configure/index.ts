import { createPrivateKey, randomBytes, randomUUID } from "node:crypto"
import { rm } from "node:fs/promises"
import { join } from "node:path"

import { InputValidationError } from "../../../installer/config/fields/index.ts"
import { CommandExecutionError } from "../../../installer/command/index.ts"
import { writePrivateFile } from "../../../installer/private-files/index.ts"
import type { WizardUI } from "../../../installer/types.ts"
import type { AzureInstallation } from "../../install/types.ts"
import { installationNames } from "../../install/settings.ts"
import type { PostDeployment, PostInputs } from "../types.ts"
import { postSetupProgress } from "../progress/index.ts"
import { readPostCredentialFile } from "../credential-file/index.ts"
import { promptForRecovery } from "../../../installer/prompt-for-recovery/index.ts"
import { PostSetupExit } from "../errors.ts"

type Reference = NonNullable<PostInputs["runtime_secret_references"]>[string]

export async function configurePostSetup(
  context: AzureInstallation & {
    ui: WizardUI
    onBootstrapFile?(path: string): void
    onPrepared?(finish: () => Promise<void>): void
    onMutation?(): void
  },
  action: "sign-in" | "github",
  inputs: PostInputs,
  deployment: PostDeployment,
): Promise<PostInputs> {
  const { config, azure, ui, directory } = context
  const names = installationNames(config)
  const vaultId = `/subscriptions/${config.azure.subscriptionId}/resourceGroups/${names.foundationGroup}/providers/Microsoft.KeyVault/vaults/${names.vault}`
  const next = structuredClone(inputs)
  next.runtime_environment_variables ??= {}
  next.runtime_secret_references ??= {}
  const references = next.runtime_secret_references
  const recoveryUI: WizardUI = {
    ...ui,
    notice(level, message) {
      if (level === "error" && ui.recoveryNotice) ui.recoveryNotice(message)
      else ui.notice?.(level, message)
    },
    async select(message, options) {
      const choice = await ui.select(message, options)
      if (choice === "exit") throw new PostSetupExit()
      return choice
    },
  }
  const progress = await postSetupProgress({ ...context, ui: recoveryUI }, action, inputs)
  if (progress.pending || Object.keys(progress.references).length) context.onMutation?.()
  let resume = false
  if (progress.hasSaved) {
    const choice = await ui.select(
      "Saved post-setup answers were found for this installation. Credential files and current access are checked again; cloud steps are not replayed.",
      [
        { label: "Resume saved answers", value: "resume" },
        {
          label: "Start over with the answers (keep stored secrets and resources)",
          value: "start-over",
        },
        { label: "Save and exit", value: "exit" },
      ],
    )
    if (choice === "exit")
      throw new PostSetupExit("Post-setup answers saved. No further steps were started.")
    if (choice === "start-over") {
      if (
        !(await ui.confirm(
          "Discard only the saved prompt answers? Existing desired inputs, stored secret versions, pending-write evidence and Azure resources are kept.",
        ))
      )
        throw new PostSetupExit("Saved post-setup answers were preserved.")
      await progress.startOver()
    } else if (choice !== "resume") throw new Error("Choose Resume, Start over, or Save and exit.")
    else resume = true
  }
  Object.assign(references, progress.references)
  context.onPrepared?.(() => progress.finish())
  async function field(
    key: string,
    label: string,
    initial: string,
    parse: (value: string) => string,
  ) {
    let previous = progress.answers[key] ?? initial
    if (resume && Object.hasOwn(progress.answers, key)) {
      try {
        return parse(previous)
      } catch (error) {
        if (!(error instanceof InputValidationError)) throw error
        recoveryUI.notice?.("error", error.message)
      }
    }
    while (true) {
      const value = await ui.text(label, previous)
      previous = value
      let checked: string
      try {
        checked = parse(value)
      } catch (error) {
        if (!(error instanceof InputValidationError)) throw error
        await promptForRecovery(recoveryUI, {
          error,
          question: `Correct ${label.split(".")[0]}.`,
          message:
            "Earlier valid answers have been saved. Correct this answer or exit and resume later.",
          actions: [{ label: "Edit this answer", value: "edit" }],
        })
        continue
      }
      await progress.saveAnswer(key, checked)
      ui.recoveryNotice?.()
      return checked
    }
  }
  async function secret(...args: string[]) {
    while (true) {
      try {
        const result = await azure("keyvault", "secret", ...args)
        ui.recoveryNotice?.()
        return result
      } catch (error) {
        context.signal?.throwIfAborted()
        if (!(error instanceof CommandExecutionError) || error.aborted) throw error
        const failure = new CommandExecutionError(
          "Key Vault secret access failed. Check this installation's access, network and secret status before retrying post-setup.",
          error.aborted,
          error.exitCode,
        )
        if (args[0] === "set") throw failure
        await promptForRecovery(recoveryUI, {
          error: failure,
          question: "Recheck Key Vault access.",
          message:
            "Earlier answers and completed secret versions are saved. Restore access or wait for propagation, then repeat only this read. No stored secrets will be changed.",
          actions: [{ label: "Recheck this secret read", value: "recheck" }],
        })
      }
    }
  }
  function reference(id: unknown, expectedVault = vaultId) {
    if (
      typeof id !== "string" ||
      !/^https:\/\/[a-z0-9-]+\.vault\.azure\.net\/secrets\/[a-z0-9-]+\/[a-f0-9]{32}$/i.test(id) ||
      new URL(id).hostname.toLowerCase() !==
        `${expectedVault.split("/").at(-1)?.toLowerCase()}.vault.azure.net`
    )
      throw new Error(
        "Key Vault did not return a versioned secret reference for the expected vault.",
      )
    return { key_vault_id: expectedVault, secret_id: id }
  }
  async function read(id: string) {
    const response = await secret(
      "show",
      "--id",
      id,
      "--query",
      "{value:value,id:id,enabled:attributes.enabled}",
    )
    let value: unknown
    try {
      value = JSON.parse(response)
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
      throw new Error(
        "Key Vault returned invalid secret metadata. Its response and credential values were not printed.",
      )
    }
    if (
      !value ||
      typeof value !== "object" ||
      !("value" in value) ||
      typeof value.value !== "string" ||
      !("enabled" in value) ||
      value.enabled !== true ||
      !("id" in value) ||
      typeof value.id !== "string"
    )
      throw new Error(
        "An existing authentication secret is missing, disabled or unreadable. It was not replaced.",
      )
    return { value: value.value, id: value.id }
  }
  async function put(name: string, value: string) {
    const key = keyForName(name)
    const path = join(directory, `post-secret-${randomUUID()}`)
    try {
      await writePrivateFile(path, value, { exclusive: true })
      let inspect = progress.pending === key
      let failure: Error | undefined = inspect
        ? new Error(
            "A previous secret write may have succeeded. Its outcome must be checked before storing another version.",
          )
        : undefined
      while (true) {
        context.signal?.throwIfAborted()
        if (inspect) {
          try {
            const known: unknown = JSON.parse(
              await secret("list", "--vault-name", names.vault, "--query", "[].name"),
            )
            if (!Array.isArray(known) || known.some((name) => typeof name !== "string"))
              throw new Error("Key Vault secret names could not be verified.")
            if (known.includes(name)) {
              const stored = await read(`https://${names.vault}.vault.azure.net/secrets/${name}`)
              if (stored.value === value) {
                const recovered = reference(stored.id)
                await progress.saveReference(key, recovered)
                ui.recoveryNotice?.()
                return recovered
              }
            }
            failure = new Error(
              "No matching stored version was verified. Recheck access/current versions, or explicitly authorize storing another version.",
            )
          } catch (error) {
            context.signal?.throwIfAborted()
            if (error instanceof DOMException && error.name === "AbortError") throw error
            if (!(error instanceof Error)) throw error
            failure = error
          }
        }
        if (failure) {
          const choice = await promptForRecovery(recoveryUI, {
            error: failure,
            question: "Review this Key Vault secret write.",
            message:
              "Answers and successful versions are saved. A failed request may already have stored a version. Checking its outcome is read-only; another write requires an explicit choice.",
            actions: [
              { label: "Recheck the stored secret only", value: "recheck" },
              { label: "Store this credential as a new version", value: "retry" },
            ],
          })
          inspect = choice === "recheck"
          if (inspect) continue
        }
        await progress.pendingUpload(key)
        let result: Reference
        try {
          context.onMutation?.()
          result = reference(
            JSON.parse(
              await secret(
                "set",
                "--vault-name",
                names.vault,
                "--name",
                name,
                "--file",
                path,
                "--encoding",
                "utf-8",
                "--query",
                "id",
              ),
            ),
          )
        } catch (error) {
          context.signal?.throwIfAborted()
          if (!(error instanceof Error)) throw error
          failure =
            error instanceof CommandExecutionError
              ? error
              : new Error(
                  "The secret-write response was invalid. Its result may be unknown; no credential values were printed.",
                )
          inspect = true
          continue
        }
        await progress.saveReference(key, result)
        ui.recoveryNotice?.()
        return result
      }
    } finally {
      await rm(path, { force: true })
    }
    function keyForName(name: string) {
      const entry = {
        "hub-authentication-encryption-key": "HUB_AUTHENTICATION_ENCRYPTION_KEY",
        "hub-bootstrap-secret": "HUB_BOOTSTRAP_SECRET",
        "github-client-secret": "GITHUB_CLIENT_SECRET",
        "github-app-private-key": "GITHUB_APP_PRIVATE_KEY_BASE64",
        "github-webhook-secret": "GITHUB_WEBHOOK_SECRET",
      }[name]
      if (!entry) throw new Error("Unsupported post-setup secret name.")
      return entry
    }
  }
  const shared: Record<string, { name: string; valid(value: string): boolean; create(): string }> =
    {
      HUB_AUTHENTICATION_ENCRYPTION_KEY: {
        name: "hub-authentication-encryption-key",
        valid: (value) =>
          Buffer.from(value, "base64").length === 32 &&
          Buffer.from(value, "base64").toString("base64") === value,
        create: () => randomBytes(32).toString("base64"),
      },
      HUB_BOOTSTRAP_SECRET: {
        name: "hub-bootstrap-secret",
        valid: (value) => value.length >= 32 && value.length <= 2_000,
        create: () => randomBytes(32).toString("hex"),
      },
    }
  const requiredReferences =
    action === "sign-in"
      ? Object.keys(shared)
      : ["GITHUB_CLIENT_SECRET", "GITHUB_APP_PRIVATE_KEY_BASE64", "GITHUB_WEBHOOK_SECRET"]
  if (new Set([...Object.keys(references), ...requiredReferences]).size > 63)
    throw new Error(
      "This configuration would exceed the runtime limit of 63 additional secret references. Review unused references separately before creating secrets.",
    )
  if (action === "sign-in") {
    const referencedOrigin = references.HUB_APPLICATION_ORIGIN
      ? (await read(references.HUB_APPLICATION_ORIGIN.secret_id)).value
      : undefined
    const currentOrigin =
      inputs.hub_application_origin ??
      inputs.runtime_environment_variables?.HUB_APPLICATION_ORIGIN ??
      referencedOrigin ??
      deployment.origin
    const origin = await field(
      "origin",
      "Public HTTPS origin (no trailing slash). A custom origin must already be bound to this Hub.",
      currentOrigin,
      (value) => {
        let url: URL
        try {
          url = new URL(value)
        } catch {
          throw new InputValidationError("Enter an exact HTTPS origin without a trailing slash.")
        }
        if (
          url.protocol !== "https:" ||
          url.origin !== value ||
          ![
            new URL(deployment.origin).hostname,
            ...deployment.customHosts.map((host) => host.toLowerCase()),
          ].includes(url.hostname)
        )
          throw new InputValidationError(
            "Use the deployed HTTPS origin or an already-bound custom domain, without a trailing slash.",
          )
        return value
      },
    )
    if (references.HUB_APPLICATION_ORIGIN) {
      const existing = await read(references.HUB_APPLICATION_ORIGIN.secret_id)
      if (existing.value !== origin)
        throw new Error(
          "The existing secret-backed origin differs. Review its rotation separately; it was preserved.",
        )
    } else {
      delete next.runtime_environment_variables.HUB_APPLICATION_ORIGIN
      next.hub_application_origin = origin
    }
    if (
      deployment.environment.GITHUB_PROVIDER_REVISION &&
      origin !== (deployment.environment.HUB_APPLICATION_ORIGIN ?? referencedOrigin)
    ) {
      const current = Number(deployment.environment.GITHUB_PROVIDER_REVISION)
      if (!Number.isSafeInteger(current) || current < 1)
        throw new Error(
          "The deployed GitHub provider revision is invalid; review it before changing origin.",
        )
      next.github_provider_revision = current + 1
      delete next.runtime_environment_variables.GITHUB_PROVIDER_REVISION
      ui.notice?.(
        "warning",
        "Changing this origin advances the GitHub provider revision. Update the GitHub App callback and webhook URLs to the same origin before sign-in testing.",
      )
    }
    next.runtime_environment_variables.HUB_TRUSTED_PROXY_HOPS = await field(
      "proxyHops",
      "Verified protected proxy hop count (0-10). Enter the actual ingress chain; post-setup does not guess it.",
      inputs.runtime_environment_variables?.HUB_TRUSTED_PROXY_HOPS ??
        deployment.environment.HUB_TRUSTED_PROXY_HOPS ??
        "",
      (value) => {
        if (!/^(?:[0-9]|10)$/.test(value))
          throw new InputValidationError("Enter the verified proxy hop count from 0 to 10.")
        return value
      },
    )
    const known: unknown = JSON.parse(
      await secret("list", "--vault-name", names.vault, "--query", "[].name"),
    )
    if (!Array.isArray(known) || known.some((name) => typeof name !== "string"))
      throw new Error("Key Vault secret inventory is unverifiable; no shared secret was replaced.")
    for (const [key, definition] of Object.entries(shared)) {
      if (
        next.runtime_environment_variables[key] !== undefined ||
        deployment.environment[key] !== undefined
      )
        throw new Error(
          "Shared authentication secrets must use Key Vault references. Review the existing direct environment configuration first.",
        )
      if (references[key]) {
        if (!definition.valid((await read(references[key].secret_id)).value!))
          throw new Error(
            "An existing shared authentication secret is invalid. It was preserved; repair it separately.",
          )
      } else if (known.includes(definition.name)) {
        const existing = await read(
          `https://${names.vault}.vault.azure.net/secrets/${definition.name}`,
        )
        if (!definition.valid(existing.value!))
          throw new Error(
            "An existing shared authentication secret is invalid. It was not rotated.",
          )
        references[key] = reference(existing.id)
        await progress.saveReference(key, references[key])
      } else {
        const value = definition.create()
        if (key === "HUB_BOOTSTRAP_SECRET") {
          const path = join(directory, `post-bootstrap-${randomUUID()}.txt`)
          await writePrivateFile(path, value, { exclusive: true })
          context.onBootstrapFile?.(path)
          ui.notice?.(
            "warning",
            `The bootstrap secret is saved privately at ${path}. Keep it in your secret manager for administrator enrollment; it is not printed or stored in Terraform inputs.`,
          )
        }
        references[key] = await put(definition.name, value)
      }
    }
    return next
  }
  if (
    !(
      inputs.hub_application_origin ??
      inputs.runtime_environment_variables?.HUB_APPLICATION_ORIGIN ??
      references.HUB_APPLICATION_ORIGIN
    ) ||
    Object.keys(shared).some((key) => !references[key])
  )
    throw new Error(
      "Configure sign-in and setup access first. GitHub App setup preserves, but does not silently generate, the shared authentication context.",
    )
  for (const [key, definition] of Object.entries(shared))
    if (!definition.valid((await read(references[key]!.secret_id)).value!))
      throw new Error(
        "The existing shared authentication context is invalid. Configure sign-in first; no shared secret was rotated.",
      )
  const githubOrigin =
    inputs.hub_application_origin ??
    inputs.runtime_environment_variables?.HUB_APPLICATION_ORIGIN ??
    (references.HUB_APPLICATION_ORIGIN
      ? (await read(references.HUB_APPLICATION_ORIGIN.secret_id)).value
      : undefined)
  if (
    !githubOrigin ||
    ![deployment.origin, ...deployment.customHosts.map((host) => `https://${host}`)].includes(
      githubOrigin,
    )
  )
    throw new Error(
      "The configured origin is not bound to this Hub. Configure sign-in with the intended origin first.",
    )
  ui.status(
    `GitHub URLs: homepage ${githubOrigin}; callback ${githubOrigin}/api/auth/github/callback; setup ${githubOrigin}/settings/github/setup?step=install; webhook ${githubOrigin}/api/github/webhooks.`,
  )
  await ui.wait(
    "Create a private GitHub App or explicitly reuse one. The browser setup guide lists permissions and a prefilled form. Reuse changes its single webhook destination and can affect another Hub. Install it on the intended account/repositories. Generate its client secret, RSA PEM key, and a high-entropy webhook secret, storing each in a private 0600 file inside a 0700 directory. Use the same webhook secret in GitHub. Post-setup accepts file paths, never secret text.",
  )
  const numeric = (value: string) => {
    if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)))
      throw new InputValidationError("Use a positive decimal safe integer.")
    return value
  }
  next.github_app_id = await field(
    "github_app_id",
    "GitHub App ID",
    String(inputs.github_app_id ?? inputs.runtime_environment_variables?.GITHUB_APP_ID ?? ""),
    numeric,
  )
  next.github_client_id = await field(
    "github_client_id",
    "GitHub App client ID",
    String(inputs.github_client_id ?? inputs.runtime_environment_variables?.GITHUB_CLIENT_ID ?? ""),
    (value) => {
      if (!/^\S{1,200}$/.test(value))
        throw new InputValidationError(
          "Use a nonempty client ID of at most 200 characters without whitespace.",
        )
      return value
    },
  )
  next.github_app_installation_id = await field(
    "github_app_installation_id",
    "GitHub App installation ID",
    String(
      inputs.github_app_installation_id ??
        inputs.runtime_environment_variables?.GITHUB_APP_INSTALLATION_ID ??
        "",
    ),
    numeric,
  )
  const credentials = [
    {
      key: "GITHUB_CLIENT_SECRET",
      name: "github-client-secret",
      label: "Client secret",
      validate: (value: string) => /^\S{1,2000}$/.test(value),
    },
    {
      key: "GITHUB_APP_PRIVATE_KEY_BASE64",
      name: "github-app-private-key",
      label: "RSA private key (.pem)",
      validate: (value: string) => {
        try {
          return value.length <= 16_384 && createPrivateKey(value).asymmetricKeyType === "rsa"
        } catch {
          return false
        }
      },
    },
    {
      key: "GITHUB_WEBHOOK_SECRET",
      name: "github-webhook-secret",
      label: "Webhook secret",
      validate: (value: string) => value.length >= 20 && value.length <= 2_000,
    },
  ] as const
  const replacements: { key: string; name: string; value: string }[] = []
  for (const credential of credentials) {
    if (
      next.runtime_environment_variables[credential.key] !== undefined ||
      deployment.environment[credential.key] !== undefined
    )
      throw new Error(
        "GitHub credentials must use Key Vault references. Review the existing direct environment configuration first.",
      )
    const fileKey = `${credential.key}_FILE`
    let previous = progress.answers[fileKey] ?? ""
    let recheck = resume && Object.hasOwn(progress.answers, fileKey)
    if (resume && progress.references[credential.key]) {
      previous = ""
      recheck = true
    }
    while (true) {
      const path = recheck
        ? previous
        : await ui.text(
            `${credential.label}: private file path${references[credential.key] ? " (blank keeps the existing pinned version)" : ""}`,
            previous,
          )
      previous = path
      recheck = false
      let replacement: Awaited<ReturnType<typeof readPostCredentialFile>> | undefined
      try {
        if (!path.trim() && references[credential.key]) {
          const existing = (await read(references[credential.key]!.secret_id)).value!
          const decoded =
            credential.key === "GITHUB_APP_PRIVATE_KEY_BASE64"
              ? Buffer.from(existing, "base64")
              : undefined
          if (
            (decoded && decoded.toString("base64") !== existing) ||
            !credential.validate(decoded ? decoded.toString("utf8") : existing)
          )
            throw new InputValidationError(
              "The pinned GitHub credential is invalid. Fix that version and recheck, or enter a valid replacement file. Its old version was preserved.",
            )
        } else {
          replacement = await readPostCredentialFile(path, credential.key)
        }
      } catch (error) {
        context.signal?.throwIfAborted()
        if (!(error instanceof InputValidationError) && !(error instanceof CommandExecutionError))
          throw error
        const choice = await promptForRecovery(recoveryUI, {
          error: new InputValidationError(`${credential.label} input needs correction.`),
          question: `Correct ${credential.label.toLowerCase()} input.`,
          message: `${error.message}\nEarlier answers and completed secret versions are saved. Fix the file outside the Wizard and recheck, or edit the path. Permissions are never changed automatically.`,
          actions: [
            { label: "Recheck the same file or pinned secret", value: "recheck" },
            { label: "Edit the file path", value: "edit" },
          ],
        })
        recheck = choice === "recheck"
        continue
      }
      await progress.saveAnswer(fileKey, replacement?.path ?? "")
      ui.recoveryNotice?.()
      if (replacement)
        replacements.push({
          key: credential.key,
          name: credential.name,
          value: replacement.value,
        })
      break
    }
  }
  const liveRevision = Number(deployment.environment.GITHUB_PROVIDER_REVISION ?? 0)
  const changed =
    replacements.length > 0 ||
    next.github_app_id !== deployment.environment.GITHUB_APP_ID ||
    next.github_client_id !== deployment.environment.GITHUB_CLIENT_ID ||
    next.github_app_installation_id !== deployment.environment.GITHUB_APP_INSTALLATION_ID
  next.github_provider_revision = Number(
    await field(
      "github_provider_revision",
      "GitHub provider revision. Keep it for unchanged settings; use the next consecutive revision for changes or re-enabling sign-in.",
      String(
        Math.max(
          inputs.github_provider_revision ??
            Number(inputs.runtime_environment_variables?.GITHUB_PROVIDER_REVISION ?? 0),
          liveRevision + (changed ? 1 : 0),
          1,
        ),
      ),
      (value) => {
        numeric(value)
        if (Number(value) < liveRevision || (changed && Number(value) !== liveRevision + 1))
          throw new InputValidationError(
            "Changed GitHub settings require the next consecutive deployed provider revision.",
          )
        return value
      },
    ),
  )
  for (const name of [
    "GITHUB_APP_ID",
    "GITHUB_CLIENT_ID",
    "GITHUB_APP_INSTALLATION_ID",
    "GITHUB_PROVIDER_REVISION",
  ])
    delete next.runtime_environment_variables[name]
  for (const credential of replacements)
    references[credential.key] = await put(credential.name, credential.value)
  return next
}

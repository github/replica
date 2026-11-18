import { createHash, createPrivateKey, randomBytes, randomUUID } from "node:crypto"
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
import { isBoundPostOrigin } from "../bound-origin/index.ts"

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
  const liveSecretReferences: unknown = JSON.parse(
    deployment.environment.AZURE_KEY_VAULT_SECRET_REFERENCES ?? "null",
  )
  if (
    !liveSecretReferences ||
    typeof liveSecretReferences !== "object" ||
    Array.isArray(liveSecretReferences) ||
    Object.values(liveSecretReferences).some((value) => typeof value !== "string")
  )
    throw new Error("The deployed startup secret references are missing or unsupported.")
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
  const progress = await postSetupProgress(
    { ...context, ui: recoveryUI },
    action,
    inputs,
    deployment.image,
  )
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
  async function verifiedGitHubRevision() {
    if (
      !(await ui.confirm(
        "Have you independently verified the last stored GitHub provider revision and enabled state in Hub's database? A deployed environment revision may not have reconciled; a disabled provider retains its last revision.",
      ))
    )
      throw new PostSetupExit(
        "Verify the GitHub provider's stored revision and enabled state before continuing. No provider changes were started.",
      )
    while (true) {
      const value = await ui.text(
        "Last stored GitHub provider revision (enter 0 only if no GitHub provider has ever been initialized)",
        "",
      )
      if (
        /^(?:0|[1-9]\d*)$/.test(value) &&
        Number.isSafeInteger(Number(value)) &&
        Number(value) <= 2_147_483_647
      ) {
        ui.recoveryNotice?.()
        return Number(value)
      }
      await promptForRecovery(recoveryUI, {
        error: new InputValidationError(
          "Enter the verified stored revision as 0 or a positive integer.",
        ),
        question: "Correct the stored GitHub provider revision.",
        message:
          "Verify the database state before continuing. A disabled provider keeps its last revision.",
        actions: [{ label: "Edit the stored revision", value: "edit" }],
      })
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
  function reference(id: unknown, expectedVault = vaultId, expectedName?: string) {
    if (
      typeof id !== "string" ||
      !/^https:\/\/[a-z0-9-]+\.vault\.azure\.net\/secrets\/[a-z0-9-]+\/[a-f0-9]{32}$/i.test(id) ||
      new URL(id).hostname.toLowerCase() !==
        `${expectedVault.split("/").at(-1)?.toLowerCase()}.vault.azure.net` ||
      (expectedName !== undefined &&
        new URL(id).pathname.split("/")[2]?.toLowerCase() !== expectedName.toLowerCase())
    )
      throw new Error(
        "Key Vault did not return a versioned reference for the expected vault and secret.",
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
  function existingReference(input: Reference) {
    if (
      !/^https:\/\/[a-z0-9-]{1,24}\.vault\.azure\.net\/secrets\/[a-z0-9-]{1,127}(\/[a-f0-9]{32})?$/i.test(
        input.secret_id,
      ) ||
      new URL(input.secret_id).hostname.toLowerCase() !==
        `${input.key_vault_id.split("/").at(-1)?.toLowerCase()}.vault.azure.net`
    )
      throw new Error(
        "The existing Key Vault reference does not identify its expected vault and secret.",
      )
    const [, , name, version] = new URL(input.secret_id).pathname.split("/")
    if (!name) throw new Error("The existing Key Vault reference does not identify a secret.")
    return { name, version }
  }
  async function readExisting(input: Reference) {
    const expected = existingReference(input)
    const stored = await read(input.secret_id)
    const pinned = reference(stored.id, input.key_vault_id, expected.name)
    if (expected.version && pinned.secret_id.toLowerCase() !== input.secret_id.toLowerCase())
      throw new Error("Key Vault returned a different version than the requested pinned secret.")
    return { value: stored.value, pinned }
  }
  async function put(key: string, name: string, value: string) {
    if (progress.pending && progress.pending !== key)
      throw new Error(
        "A different secret write has an unknown outcome. Resolve it before storing another credential; its evidence was preserved.",
      )
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
                const recovered = reference(stored.id, vaultId, name)
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
            vaultId,
            name,
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
    if (
      references.HUB_TRUSTED_PROXY_HOPS ||
      Object.hasOwn(liveSecretReferences, "HUB_TRUSTED_PROXY_HOPS")
    )
      throw new Error(
        "The proxy hop count is secret-backed. Review that reference separately before configuring sign-in; it was preserved.",
      )
    const originSecret = references.HUB_APPLICATION_ORIGIN
      ? await readExisting(references.HUB_APPLICATION_ORIGIN)
      : undefined
    const referencedOrigin = originSecret?.value
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
        if (!isBoundPostOrigin(value, deployment))
          throw new InputValidationError(
            "Use the exact deployed HTTPS origin or an already-bound custom domain on the standard HTTPS port, without a trailing slash.",
          )
        return value
      },
    )
    const originChanged =
      origin !== (deployment.environment.HUB_APPLICATION_ORIGIN ?? referencedOrigin)
    if (
      originChanged &&
      [
        ...Object.keys(deployment.environment),
        ...Object.keys(inputs.runtime_environment_variables ?? {}),
        ...Object.keys(references),
        ...Object.keys(liveSecretReferences),
      ].some((key) => key.startsWith("ENTRA_OIDC_"))
    )
      throw new Error(
        "Changing the public origin also changes the Entra callback. Coordinate the Entra provider revision and callback separately before changing this origin; existing settings were preserved.",
      )
    if (originSecret) {
      if (originSecret.value !== origin)
        throw new Error(
          "The existing secret-backed origin differs. Review its rotation separately; it was preserved.",
        )
      references.HUB_APPLICATION_ORIGIN = originSecret.pinned
    } else {
      delete next.runtime_environment_variables.HUB_APPLICATION_ORIGIN
      next.hub_application_origin = origin
    }
    if (
      originChanged &&
      (deployment.environment.GITHUB_PROVIDER_REVISION ||
        next.github_provider_revision ||
        next.runtime_environment_variables.GITHUB_PROVIDER_REVISION)
    ) {
      const current = await verifiedGitHubRevision()
      if (current >= 2_147_483_647)
        throw new Error(
          "The stored GitHub provider revision cannot advance further. Review the provider separately before changing origin.",
        )
      if (
        !(await ui.confirm(
          "Changing this origin advances the GitHub provider revision and will enable GitHub sign-in, even if it is currently disabled. Explicitly allow GitHub sign-in to be enabled?",
        ))
      )
        throw new PostSetupExit(
          "GitHub sign-in was not authorized to be enabled. Desired inputs and secret versions were preserved.",
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
    const sharedEntries = Object.entries(shared).sort(
      ([left], [right]) => Number(right === progress.pending) - Number(left === progress.pending),
    )
    for (const [key, definition] of sharedEntries) {
      if (
        next.runtime_environment_variables[key] !== undefined ||
        deployment.environment[key] !== undefined
      )
        throw new Error(
          "Shared authentication secrets must use Key Vault references. Review the existing direct environment configuration first.",
        )
      if (references[key]) {
        if (progress.pending === key)
          throw new Error(
            "A shared secret write has an unknown outcome. Review its pinned reference and pending-write evidence before continuing.",
          )
        const existing = await readExisting(references[key])
        if (!definition.valid(existing.value))
          throw new Error(
            "An existing shared authentication secret is invalid. It was preserved; repair it separately.",
          )
        references[key] = existing.pinned
      } else if (known.includes(definition.name)) {
        const existing = await read(
          `https://${names.vault}.vault.azure.net/secrets/${definition.name}`,
        )
        if (!definition.valid(existing.value!))
          throw new Error(
            "An existing shared authentication secret is invalid. It was not rotated.",
          )
        references[key] = reference(existing.id, vaultId, definition.name)
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
        references[key] = await put(key, definition.name, value)
      }
    }
    if (progress.pending)
      throw new Error(
        "A shared secret write still has an unknown outcome; its evidence was preserved.",
      )
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
  for (const [key, definition] of Object.entries(shared)) {
    const existing = await readExisting(references[key]!)
    if (!definition.valid(existing.value))
      throw new Error(
        "The existing shared authentication context is invalid. Configure sign-in first; no shared secret was rotated.",
      )
    references[key] = existing.pinned
  }
  const originSecret = references.HUB_APPLICATION_ORIGIN
    ? await readExisting(references.HUB_APPLICATION_ORIGIN)
    : undefined
  const githubOrigin =
    inputs.hub_application_origin ??
    inputs.runtime_environment_variables?.HUB_APPLICATION_ORIGIN ??
    originSecret?.value
  if (!isBoundPostOrigin(githubOrigin, deployment))
    throw new Error(
      "The configured origin is not bound to this Hub. Configure sign-in with the intended origin first.",
    )
  if (originSecret) references.HUB_APPLICATION_ORIGIN = originSecret.pinned
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
          const existing = await readExisting(references[credential.key]!)
          const decoded =
            credential.key === "GITHUB_APP_PRIVATE_KEY_BASE64"
              ? Buffer.from(existing.value, "base64")
              : undefined
          if (
            (decoded && decoded.toString("base64") !== existing.value) ||
            !credential.validate(decoded ? decoded.toString("utf8") : existing.value)
          )
            throw new InputValidationError(
              "The pinned GitHub credential is invalid. Fix that version and recheck, or enter a valid replacement file. Its old version was preserved.",
            )
          references[credential.key] = existing.pinned
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
      if (replacement) {
        const existing = references[credential.key]
        if (existing && existing.key_vault_id.toLowerCase() !== vaultId.toLowerCase())
          throw new Error(
            "The existing GitHub credential belongs to a different Key Vault. Review its rotation separately; it was preserved.",
          )
        if (existing) existingReference(existing)
        replacements.push({
          key: credential.key,
          name: existing ? new URL(existing.secret_id).pathname.split("/")[2]! : credential.name,
          value: replacement.value,
        })
      }
      break
    }
  }
  if (progress.pending && !replacements.some((credential) => credential.key === progress.pending))
    throw new Error(
      `The earlier ${progress.pending} write has an unknown outcome. Supply its private credential file to resolve it before another upload; its evidence was preserved.`,
    )
  const changed =
    replacements.length > 0 ||
    next.github_app_id !== deployment.environment.GITHUB_APP_ID ||
    next.github_client_id !== deployment.environment.GITHUB_CLIENT_ID ||
    next.github_app_installation_id !== deployment.environment.GITHUB_APP_INSTALLATION_ID ||
    credentials.some(
      ({ key }) =>
        references[key]?.secret_id !==
        (liveSecretReferences as Record<string, string>)[key],
    )
  const storedRevision = await verifiedGitHubRevision()
  const savedRevision =
    inputs.github_provider_revision ??
    Number(inputs.runtime_environment_variables?.GITHUB_PROVIDER_REVISION ?? 0)
  // Match the Hub GitHub adapter's canonical public-configuration serialization.
  const expectedDigest = createHash("sha256")
    .update(
      JSON.stringify({
        authorizationEndpoint: "https://github.com/login/oauth/authorize",
        callbackUri: new URL("/api/auth/github/callback", githubOrigin).toString(),
        clientId: next.github_client_id,
        tokenEndpoint: "https://github.com/login/oauth/access_token",
        userEndpoint: "https://api.github.com/user",
        installationId: Number(next.github_app_installation_id),
      }),
    )
    .digest("hex")
  const canKeepRevision =
    storedRevision > 0 &&
    !changed &&
    savedRevision <= storedRevision &&
    (await ui.confirm(
      `Does the stored GitHub provider show enabled=true and configuration_digest=${expectedDigest}? If not, the next revision is required.`,
    ))
  if (!canKeepRevision && storedRevision >= 2_147_483_647)
    throw new Error("The stored GitHub provider revision cannot advance further.")
  next.github_provider_revision = Number(
    await field(
      "github_provider_revision",
      "GitHub provider revision. Keep it only for an enabled, unchanged provider; otherwise use the next consecutive stored revision.",
      String(storedRevision + (canKeepRevision ? 0 : 1)),
      (value) => {
        numeric(value)
        const revision = Number(value)
        if (
          revision > 2_147_483_647 ||
          (revision !== storedRevision + 1 && !(canKeepRevision && revision === storedRevision))
        )
          throw new InputValidationError(
            canKeepRevision
              ? `Use the stored provider revision ${storedRevision} or the next consecutive revision ${storedRevision + 1}.`
              : `Use the next consecutive stored provider revision, ${storedRevision + 1}.`,
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
  replacements.sort(
    (left, right) =>
      Number(right.key === progress.pending) - Number(left.key === progress.pending),
  )
  for (const credential of replacements)
    references[credential.key] = await put(credential.key, credential.name, credential.value)
  return next
}

type SecretReference = { key_vault_id: string; secret_id: string }

export interface HubPreviewInputs {
  hub_application_origin?: string
  github_app_id?: string
  github_client_id?: string
  github_app_installation_id?: string
  github_provider_revision?: number
  runtime_environment_variables?: Record<string, string>
  runtime_secret_references?: Record<string, SecretReference>
}

const enabledKey = "HUB_PRIVATE_PREVIEW_ENABLED"
const readerSecretKey = "HUB_PRIVATE_PREVIEW_READER_SECRET"
// The wizard owns these Hub settings; manual values are replaced on every deployment.
export const ownedHubSettings = [
  enabledKey,
  "HUB_PRIVATE_PREVIEW_ORIGIN",
  "HUB_PRIVATE_PREVIEW_INLINE_ENABLED",
  "HUB_PRIVATE_PREVIEW_WRITE_ENABLED",
  "HUB_PRIVATE_PREVIEW_WRITE_REPOSITORY_ID",
  "HUB_PRIVATE_PREVIEW_WRITE_CONTAINER",
] as const

export function hubPreviewInputs<T extends HubPreviewInputs>(
  inputs: T,
  {
    playback,
    readerSecret,
    writerRepositoryIds,
  }: {
    playback?: { origin: string; inline: boolean }
    readerSecret?: SecretReference
    writerRepositoryIds: readonly string[]
  },
): T {
  const secrets = { ...inputs.runtime_secret_references }
  if (ownedHubSettings.some((name) => name in secrets))
    throw new Error(
      `Private preview blocked: remove the Key Vault references for ${ownedHubSettings.join(", ")} from the saved Hub inputs. The wizard sets those values. No changes were made.`,
    )
  const environment = Object.fromEntries(
    Object.entries(inputs.runtime_environment_variables ?? {}).filter(
      ([name]) => !(ownedHubSettings as readonly string[]).includes(name),
    ),
  )
  if (playback) {
    if (!readerSecret) throw new Error("Private preview needs the shared reader secret.")
    Object.assign(environment, {
      [enabledKey]: "true",
      HUB_PRIVATE_PREVIEW_ORIGIN: playback.origin,
      HUB_PRIVATE_PREVIEW_INLINE_ENABLED: String(playback.inline),
    })
    secrets[readerSecretKey] = readerSecret
  } else if (readerSecretKey in secrets) {
    // Keep the reference so the release does not delete Hub's secret grant; false ignores it.
    environment[enabledKey] = "false"
  }
  if (writerRepositoryIds.length)
    Object.assign(environment, {
      HUB_PRIVATE_PREVIEW_WRITE_ENABLED: "true",
      HUB_PRIVATE_PREVIEW_WRITE_REPOSITORY_ID: writerRepositoryIds.join(","),
      HUB_PRIVATE_PREVIEW_WRITE_CONTAINER: "private-preview-artifacts",
    })
  const next: T = { ...inputs }
  if (Object.keys(environment).length || inputs.runtime_environment_variables)
    next.runtime_environment_variables = environment
  if (Object.keys(secrets).length || inputs.runtime_secret_references)
    next.runtime_secret_references = secrets
  return next
}

export class PrivatePreviewChoiceError extends Error {}

// Hub starts private preview only with complete GitHub sign-in or local administrator sign-in.
const githubSignIn = [
  "GITHUB_APP_ID",
  "GITHUB_APP_PRIVATE_KEY_BASE64",
  "GITHUB_APP_INSTALLATION_ID",
  "GITHUB_WEBHOOK_SECRET",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "GITHUB_PROVIDER_REVISION",
] as const

function signInConfigured(inputs: HubPreviewInputs) {
  const named: Record<string, unknown> = {
    GITHUB_APP_ID: inputs.github_app_id,
    GITHUB_CLIENT_ID: inputs.github_client_id,
    GITHUB_APP_INSTALLATION_ID: inputs.github_app_installation_id,
    GITHUB_PROVIDER_REVISION: inputs.github_provider_revision,
  }
  const supplied = (name: string) =>
    named[name] != null ||
    Boolean(inputs.runtime_environment_variables?.[name]?.trim()) ||
    name in (inputs.runtime_secret_references ?? {})
  return (
    githubSignIn.every(supplied) ||
    inputs.runtime_environment_variables?.HUB_LOCAL_SIGN_IN?.trim() === "true" ||
    "HUB_LOCAL_SIGN_IN" in (inputs.runtime_secret_references ?? {})
  )
}

// Checks a choice against saved Hub inputs; setup runs it before saving the choice or any Azure change.
export function checkPrivatePreviewChoice(
  choice: { reader: string; hostname?: string } | undefined,
  inputs: HubPreviewInputs,
  previous?: { reader: string; hostname?: string },
): void {
  const block = (reason: string): never => {
    throw new PrivatePreviewChoiceError(
      `Private preview blocked: ${reason} The private prototype service was not changed.`,
    )
  }
  const referenced = ownedHubSettings.filter((name) => name in (inputs.runtime_secret_references ?? {}))
  if (referenced.length)
    block(`remove the Key Vault references for ${referenced.join(", ")} from the saved Hub inputs. The wizard sets those values.`)
  if (choice?.reader !== "on") return
  const origin = hubOrigin(inputs)
  if (!origin || !hubTrustedProxyHops(inputs) || !signInConfigured(inputs))
    block(
      "turning on the private prototype service needs Hub's sign-in settings: HUB_APPLICATION_ORIGIN, HUB_TRUSTED_PROXY_HOPS, and complete GitHub sign-in or local administrator sign-in. Choose Off, run npm run setup:post to configure sign-in, then run Update and choose On.",
    )
  const hubHost = new URL(origin!).hostname
  if (choice.hostname ? !sameSiteHosts(hubHost, choice.hostname) : !hubHost.endsWith(".azurecontainerapps.io"))
    block(
      choice.hostname
        ? `${choice.hostname} must be a hostname under Hub's hostname ${hubHost}, such as preview.${hubHost}.`
        : `Hub uses ${hubHost}, so the reader needs a custom hostname under it, such as preview.${hubHost}.`,
    )
  if (previous?.reader === "on" && previous.hostname && previous.hostname !== choice.hostname)
    block(
      `the reader uses ${previous.hostname}. Changing or removing its hostname while it is on is not supported. Choose Off first, run Update, then choose the new hostname.`,
    )
}

export function hubOrigin(inputs: HubPreviewInputs): string | undefined {
  if (inputs.runtime_secret_references?.HUB_APPLICATION_ORIGIN) return undefined
  return inputs.hub_application_origin ?? inputs.runtime_environment_variables?.HUB_APPLICATION_ORIGIN
}

export function hubTrustedProxyHops(inputs: HubPreviewInputs): number | undefined {
  const value = inputs.runtime_environment_variables?.HUB_TRUSTED_PROXY_HOPS
  const hops = Number(value)
  return value && Number.isInteger(hops) && hops >= 1 && hops <= 10 ? hops : undefined
}

// Hub checks the full Public Suffix List at startup. This conservative check accepts only
// pairs that Hub accepts too, so a release never starts a Hub that refuses its settings.
export function sameSiteHosts(hubHost: string, readerHost: string): boolean {
  const generated = ".azurecontainerapps.io"
  if (hubHost === readerHost) return false
  if (hubHost.endsWith(generated) && readerHost.endsWith(generated)) return true
  return readerHost.endsWith(`.${hubHost}`)
}

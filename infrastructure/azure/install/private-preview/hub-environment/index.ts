type SecretReference = { key_vault_id: string; secret_id: string }

export interface HubPreviewInputs {
  hub_application_origin?: string
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

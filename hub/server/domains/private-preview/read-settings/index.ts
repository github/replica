import { getDomain } from "tldts"

export class PrivatePreviewConfigurationError extends Error {}

export interface PrivatePreviewSettings {
  hubOrigin: string
  readerOrigin: string
  readerSecret: string
  inline: boolean
}

function readOrigin(value: string | undefined, key: string): URL {
  const origin = URL.parse(value ?? "")
  if (!origin || origin.origin !== value || origin.protocol !== "https:") {
    throw new PrivatePreviewConfigurationError(
      `${key} must be an exact HTTPS origin without a trailing slash.`,
    )
  }
  return origin
}

function readInline(value: string | undefined) {
  if (value === undefined || value === "false") return false
  if (value === "true") return true
  throw new PrivatePreviewConfigurationError(
    "HUB_PRIVATE_PREVIEW_INLINE_ENABLED must be true or false.",
  )
}

export function readPrivatePreviewSettings(
  environment: NodeJS.ProcessEnv,
): PrivatePreviewSettings | undefined {
  if (environment.HUB_PRIVATE_PREVIEW_ENABLED === "false") return undefined
  if (environment.HUB_PRIVATE_PREVIEW_ENABLED === undefined) {
    if (
      environment.HUB_PRIVATE_PREVIEW_ORIGIN !== undefined ||
      environment.HUB_PRIVATE_PREVIEW_READER_SECRET !== undefined ||
      environment.HUB_PRIVATE_PREVIEW_INLINE_ENABLED !== undefined
    ) {
      throw new PrivatePreviewConfigurationError(
        "Set HUB_PRIVATE_PREVIEW_ENABLED explicitly for private preview settings.",
      )
    }
    return undefined
  }
  if (environment.HUB_PRIVATE_PREVIEW_ENABLED !== "true") {
    throw new PrivatePreviewConfigurationError("HUB_PRIVATE_PREVIEW_ENABLED must be true or false.")
  }
  const hub = readOrigin(environment.HUB_APPLICATION_ORIGIN, "HUB_APPLICATION_ORIGIN")
  const reader = readOrigin(environment.HUB_PRIVATE_PREVIEW_ORIGIN, "HUB_PRIVATE_PREVIEW_ORIGIN")
  // Browsers use the whole Public Suffix List, including its private section, to decide sites.
  const hubSite = getDomain(hub.hostname, { allowPrivateDomains: true })
  const readerSite = getDomain(reader.hostname, { allowPrivateDomains: true })
  if (!hubSite || !readerSite) {
    throw new PrivatePreviewConfigurationError(
      "Private preview requires DNS hostnames for Hub and the reader.",
    )
  }
  if (hub.hostname === reader.hostname || hubSite !== readerSite) {
    throw new PrivatePreviewConfigurationError(
      "Private preview requires a different hostname on the same site as Hub.",
    )
  }
  const readerSecret = environment.HUB_PRIVATE_PREVIEW_READER_SECRET
  if (!readerSecret || !/^[A-Za-z0-9_-]{43}$/.test(readerSecret)) {
    throw new PrivatePreviewConfigurationError(
      "HUB_PRIVATE_PREVIEW_READER_SECRET must be a 32-byte base64url secret.",
    )
  }
  return {
    hubOrigin: hub.origin,
    readerOrigin: reader.origin,
    readerSecret,
    inline: readInline(environment.HUB_PRIVATE_PREVIEW_INLINE_ENABLED),
  }
}

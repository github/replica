import { getDomain } from "tldts"

export interface PrivatePreviewSettings {
  hubOrigin: string
  readerOrigin: string
  readerSecret: string
}

function readOrigin(value: string | undefined, key: string): URL {
  const origin = URL.parse(value ?? "")
  if (!origin || origin.origin !== value || origin.protocol !== "https:") {
    throw new Error(`${key} must be an exact HTTPS origin without a trailing slash.`)
  }
  return origin
}

export function readPrivatePreviewSettings(
  environment: NodeJS.ProcessEnv,
): PrivatePreviewSettings | undefined {
  if (environment.HUB_PRIVATE_PREVIEW_ENABLED === "false") return undefined
  if (environment.HUB_PRIVATE_PREVIEW_ENABLED === undefined) {
    if (
      environment.HUB_PRIVATE_PREVIEW_ORIGIN !== undefined ||
      environment.HUB_PRIVATE_PREVIEW_READER_SECRET !== undefined
    ) {
      throw new Error("Set HUB_PRIVATE_PREVIEW_ENABLED explicitly for private preview settings.")
    }
    return undefined
  }
  if (environment.HUB_PRIVATE_PREVIEW_ENABLED !== "true") {
    throw new Error("HUB_PRIVATE_PREVIEW_ENABLED must be true or false.")
  }
  const hub = readOrigin(environment.HUB_APPLICATION_ORIGIN, "HUB_APPLICATION_ORIGIN")
  const reader = readOrigin(environment.HUB_PRIVATE_PREVIEW_ORIGIN, "HUB_PRIVATE_PREVIEW_ORIGIN")
  const hubDomain = getDomain(hub.hostname, { allowPrivateDomains: true })
  const readerDomain = getDomain(reader.hostname, { allowPrivateDomains: true })
  const readerParentDomain = getDomain(reader.hostname)
  const hubParentDomain = getDomain(hub.hostname)
  if (
    hub.hostname === reader.hostname ||
    hub.hostname.endsWith(`.${reader.hostname}`) ||
    reader.hostname.endsWith(`.${hub.hostname}`) ||
    (hubDomain !== null && hubDomain === readerDomain)
  ) {
    throw new Error("Private preview requires a separate site from Hub.")
  }
  if (!hubParentDomain || !readerParentDomain) {
    throw new Error("Private preview requires DNS hostnames for Hub and the reader.")
  }
  const readerSecret = environment.HUB_PRIVATE_PREVIEW_READER_SECRET
  if (!readerSecret || !/^[A-Za-z0-9_-]{43}$/.test(readerSecret)) {
    throw new Error("HUB_PRIVATE_PREVIEW_READER_SECRET must be a 32-byte base64url secret.")
  }
  return { hubOrigin: hub.origin, readerOrigin: reader.origin, readerSecret }
}

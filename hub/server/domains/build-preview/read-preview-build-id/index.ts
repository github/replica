import type { Request } from "express"

export function readPreviewBuildId(request: Request, previewBaseOrigin: string): string | null {
  const base = new URL(previewBaseOrigin)
  const host = request.get("host")
  if (!host) return null
  let requestUrl: URL
  try {
    requestUrl = new URL(`${base.protocol}//${host}`)
  } catch {
    return null
  }
  if (requestUrl.port !== base.port) return null
  const suffix = `.${base.hostname}`
  if (!requestUrl.hostname.endsWith(suffix)) return null
  const buildId = requestUrl.hostname.slice(0, -suffix.length)
  return /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(buildId) ? buildId : null
}

import type { Request } from "express"

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.cookie
  if (!header) return null
  for (const pair of header.split(";")) {
    const separator = pair.indexOf("=")
    if (separator < 0) continue
    if (pair.slice(0, separator).trim() !== name) continue
    try {
      return decodeURIComponent(pair.slice(separator + 1).trim())
    } catch {
      return null
    }
  }
  return null
}

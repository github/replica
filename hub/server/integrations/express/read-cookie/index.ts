import type { Request } from "express"

function findCookie(pairs: string[], name: string): string | undefined {
  for (const pair of pairs) {
    const separator = pair.indexOf("=")
    if (separator < 0) continue
    if (pair.slice(0, separator).trim() === name) return pair.slice(separator + 1).trim()
  }
}

export function readCookie(
  request: Pick<Request, "headers">,
  name: string,
  fallbackName?: string,
): string | null {
  const header = request.headers.cookie
  if (!header) return null
  const pairs = header.split(";")
  const value =
    findCookie(pairs, name) ?? (fallbackName ? findCookie(pairs, fallbackName) : undefined)
  try {
    return value === undefined ? null : decodeURIComponent(value)
  } catch {
    return null
  }
}

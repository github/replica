export function readCookie(header: string | undefined, name: string): string | null {
  if (!header || header.length > 8_192) return null
  for (const part of header.split(";")) {
    const separator = part.indexOf("=")
    if (separator < 1) continue
    if (part.slice(0, separator).trim() === name) {
      const value = part.slice(separator + 1).trim()
      return value.length <= 1_000 ? value : null
    }
  }
  return null
}

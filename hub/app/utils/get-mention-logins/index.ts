export function getMentionLogins(body: string) {
  const matches = body.matchAll(
    /(?<![A-Za-z0-9_@/])@([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)(?![A-Za-z0-9_-])/g,
  )
  return Array.from(
    new Set(Array.from(matches).flatMap((token) => (token[1] ? [token[1].toLowerCase()] : []))),
  )
}

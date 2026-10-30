export function getUrlOrigin(url: string | undefined) {
  if (!url) return null

  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

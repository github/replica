export function getUrlOrigin(url: string | undefined) {
  if (!url) return null

  try {
    const parsed = new URL(url)
    if (
      /^\/api\/repositories\/[^/]+\/(?:prototypes\/[^/]+\/builds\/\d+|template-builds\/[^/]+)\/access$/.test(
        parsed.pathname,
      )
    ) {
      const previewOrigin = parsed.searchParams.get("preview_origin")
      if (previewOrigin) {
        const preview = new URL(previewOrigin)
        if (
          preview.origin === previewOrigin &&
          preview.pathname === "/" &&
          !preview.search &&
          !preview.hash &&
          ["http:", "https:"].includes(preview.protocol)
        ) {
          return preview.origin
        }
      }
    }
    return parsed.origin
  } catch {
    return null
  }
}

import { normalizeStartPage } from "@utils/normalize-start-page"
import type { ReviewRoute } from "@utils/review-anchor/types"

const URI_PATH = /^(?:[a-z0-9._~!$&'()*+,;=:@/-]|%[0-9a-f]{2})*$/i

export function createPreviewPrototypePrompt({
  brief,
  branchInstructions,
  branchPageInstructions,
  templateLandingPageInstructions,
  previewUrl,
  initialRoute,
  route,
}: {
  brief: string
  branchInstructions: string
  branchPageInstructions: string
  templateLandingPageInstructions?: string
  previewUrl?: string
  initialRoute?: string
  route?: ReviewRoute | null
}) {
  const url = previewUrl ? URL.parse(previewUrl) : null
  const previewAvailable =
    url && ["http:", "https:"].includes(url.protocol) && !url.username && !url.password
  let pathname: string | undefined
  if (previewAvailable || (!previewUrl && initialRoute)) {
    const startingPathname = initialRoute?.split(/[?#]/, 1)[0] ?? url?.pathname
    pathname = promptPathname(route?.pathname ?? startingPathname)
    if (!pathname && (initialRoute !== undefined || templateLandingPageInstructions)) {
      pathname = promptPathname(startingPathname)
    }
  }

  const pageContext = pathname
    ? branchPageInstructions.replace("%{route}", () => JSON.stringify(pathname))
    : ""
  const landingPageInstructions =
    pathname && templateLandingPageInstructions
      ? templateLandingPageInstructions.replace("%{route}", () => JSON.stringify(pathname))
      : ""

  return [
    brief.trim(),
    pageContext.trim(),
    branchInstructions.trim(),
    landingPageInstructions.trim(),
  ]
    .filter(Boolean)
    .join("\n\n")
}

function promptPathname(value: string | undefined) {
  if (!value?.startsWith("/") || /[?#]/.test(value) || !normalizeStartPage(value)) return

  try {
    if (/[\s%?#]/u.test(decodeURIComponent(value))) return
  } catch {
    return
  }

  const pathname = URL.parse(value, "https://preview.invalid")?.pathname
  return pathname && URI_PATH.test(pathname) && normalizeStartPage(pathname) ? pathname : undefined
}

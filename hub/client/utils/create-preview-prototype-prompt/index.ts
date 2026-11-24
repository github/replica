import { normalizeStartPage } from "@utils/normalize-start-page"
import { previewLogicalPathname } from "@utils/preview-logical-pathname"
import type { ReviewRoute } from "@utils/review-anchor/types"

const URI_PATH = /^(?:[a-z0-9._~!$&'()*+,;=:@/-]|%[0-9a-f]{2})*$/i

export function createPreviewPrototypePrompt({
  brief,
  branchInstructions,
  branchPageInstructions,
  templateLandingPageInstructions,
  previewUrl,
  previewReady,
  initialRoute,
  templateRoute = initialRoute,
  route,
  previewMount,
}: {
  brief: string
  branchInstructions: string
  branchPageInstructions: string
  templateLandingPageInstructions?: string
  previewUrl?: string
  previewReady?: boolean
  initialRoute?: string
  templateRoute?: string
  route?: ReviewRoute | null
  previewMount?: string | null
}) {
  const url = previewUrl ? URL.parse(previewUrl) : null
  const previewAvailable =
    previewReady !== false &&
    url &&
    ["http:", "https:"].includes(url.protocol) &&
    !url.username &&
    !url.password
  const declared = initialRoute ? URL.parse(initialRoute, "https://preview.invalid") : null
  const startingPathname =
    initialRoute === undefined
      ? url?.pathname
      : normalizeStartPage(initialRoute)
        ? declared?.pathname
        : undefined
  const startingHash = declared?.hash ?? url?.hash ?? ""
  const starting = promptPathname(startingPathname)
  const viewed = route ? promptPathname(previewLogicalPathname(route.pathname, previewMount)) : null
  const viewedHash = viewed ? (route?.hash ?? "") : startingHash
  const pathname =
    previewAvailable &&
    (!route || viewed || initialRoute !== undefined || templateLandingPageInstructions)
      ? (viewed ?? starting)
      : null
  const pageContext = pathname
    ? branchPageInstructions.replace("%{route}", () => JSON.stringify(pathname))
    : ""
  const template =
    templateRoute && normalizeStartPage(templateRoute)
      ? URL.parse(templateRoute, "https://preview.invalid")
      : null
  const landingPathname = pathname ?? promptPathname(template?.pathname)
  const landingHash = pathname ? viewedHash : (template?.hash ?? "")
  const landingPageInstructions =
    landingPathname &&
    templateLandingPageInstructions &&
    !landingHash.startsWith("#/") &&
    !landingHash.startsWith("#!") &&
    !(landingPathname === template?.pathname && /^#(?:\/|!)/.test(template.hash))
      ? templateLandingPageInstructions.replace("%{route}", () => JSON.stringify(landingPathname))
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
    if (/[?#]/u.test(decodeURIComponent(value))) return
  } catch {
    return
  }

  const pathname = URL.parse(value, "https://preview.invalid")?.pathname
  return pathname && URI_PATH.test(pathname) && normalizeStartPage(pathname) ? pathname : undefined
}

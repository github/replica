import type { ReviewRoute } from "@utils/review-anchor/types"

const URI_PATH = /^(?:[a-z0-9._~!$&'()*+,;=:@/-]|%[0-9a-f]{2})*$/i
const URI_FRAGMENT = /^(?:[a-z0-9._~!$&'()*+,;=:@/?-]|%[0-9a-f]{2})*$/i

export function createPreviewPrototypePrompt({
  brief,
  branchInstructions,
  branchPageInstructions,
  templateLandingPageInstructions,
  previewUrl,
  route,
}: {
  brief: string
  branchInstructions: string
  branchPageInstructions: string
  templateLandingPageInstructions?: string
  previewUrl?: string
  route?: ReviewRoute | null
}) {
  let pageContext = ""
  let landingPageInstructions = ""
  if (previewUrl) {
    try {
      const url = new URL(previewUrl)
      const initialRoute = `${url.pathname}${url.search}${url.hash}`
      const reportedRoute = route ? `${route.pathname}${route.search}${route.hash}` : initialRoute
      const viewedRoute = templateLandingPageInstructions
        ? [reportedRoute, initialRoute].map(templateRoute).find((value) => value !== undefined)
        : reportedRoute
      const pathname = viewedRoute?.split(/[?#]/, 1)[0] ?? ""
      const decodedPathname = decodeURIComponent(pathname)
      if (
        viewedRoute &&
        ["http:", "https:"].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        decodedPathname.startsWith("/") &&
        !decodedPathname.startsWith("//") &&
        !decodedPathname.includes("\\") &&
        !/^\/__replica(?:\/|$)/.test(decodedPathname)
      ) {
        pageContext = branchPageInstructions.replace("%{route}", () => JSON.stringify(viewedRoute))
        if (templateLandingPageInstructions) {
          landingPageInstructions = templateLandingPageInstructions.replace("%{route}", () =>
            JSON.stringify(viewedRoute),
          )
        }
      }
    } catch {
      // An unavailable preview destination must not prevent submitting the brief.
    }
  }

  return [
    brief.trim(),
    pageContext.trim(),
    branchInstructions.trim(),
    landingPageInstructions.trim(),
  ]
    .filter(Boolean)
    .join("\n\n")
}

function templateRoute(value: string) {
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    new TextEncoder().encode(value).length > 2048 ||
    /[\s\\]|\p{Cc}/u.test(value)
  )
    return undefined

  try {
    const pathname = decodeURIComponent(value.split(/[?#]/, 1)[0]!)
    if (
      pathname.startsWith("//") ||
      /[\s\\%]|\p{Cc}/u.test(pathname) ||
      pathname.split("/").some((segment) => [".", "..", ".replica-internal"].includes(segment)) ||
      /^\/__replica(?:\/|$)/.test(pathname)
    )
      return undefined

    const url = new URL(value, "http://preview.invalid")
    const serialized = `${url.pathname}${url.search}${url.hash}`
    return new TextEncoder().encode(serialized).length <= 2048 &&
      URI_PATH.test(url.pathname) &&
      URI_FRAGMENT.test(url.hash.slice(1))
      ? serialized
      : undefined
  } catch {
    return undefined
  }
}

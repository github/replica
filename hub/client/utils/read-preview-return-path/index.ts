import { normalizeStartPage } from "@utils/normalize-start-page"
import { REVIEW_ROUTE_SCHEMA } from "@utils/review-anchor/schemas"

export function readPreviewReturnPath(route: string | undefined): string | null {
  if (!route?.startsWith("/") || !normalizeStartPage(route)) return null
  const destination = URL.parse(route, "https://preview.invalid")
  if (
    !destination ||
    `${destination.pathname}${destination.search}${destination.hash}` !== route ||
    !REVIEW_ROUTE_SCHEMA.safeParse({
      pathname: destination.pathname,
      search: destination.search,
      hash: destination.hash,
    }).success
  ) {
    return null
  }
  return route
}

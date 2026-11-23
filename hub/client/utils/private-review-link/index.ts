import { REVIEW_ROUTE_SCHEMA } from "@utils/review-anchor/schemas"

export function privateReviewLink({
  baseUrl,
  buildNumber,
  route,
  threadId,
}: {
  baseUrl: string
  buildNumber?: number
  route?: string
  threadId?: number
}) {
  const url = new URL(baseUrl)
  url.search = ""
  url.hash = ""
  if (buildNumber !== undefined) url.searchParams.set("build", String(buildNumber))
  if (threadId !== undefined) url.searchParams.set("comment", String(threadId))
  if (route && new TextEncoder().encode(route).length <= 2048) {
    const destination = URL.parse(route, url)
    if (
      route.startsWith("/") &&
      !route.startsWith("//") &&
      !/[\p{Cc}\p{Cs}\p{Z}\\]/u.test(route) &&
      destination?.origin === url.origin &&
      `${destination.pathname}${destination.search}${destination.hash}` === route &&
      REVIEW_ROUTE_SCHEMA.safeParse({
        pathname: destination.pathname,
        search: destination.search,
        hash: destination.hash,
      }).success
    ) {
      url.searchParams.set("return_path", route)
    }
  }
  return url.href
}

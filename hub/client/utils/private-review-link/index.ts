import { readPreviewReturnPath } from "@utils/read-preview-return-path"

export function privateReviewLink({
  baseUrl,
  buildNumber,
  route,
  logicalRoute,
  threadId,
}: {
  baseUrl: string
  buildNumber?: number
  route?: string
  logicalRoute?: boolean
  threadId?: number
}) {
  const url = new URL(baseUrl)
  url.search = ""
  url.hash = ""
  if (buildNumber !== undefined) url.searchParams.set("build", String(buildNumber))
  if (threadId !== undefined) url.searchParams.set("comment", String(threadId))
  if (route !== undefined) {
    const destination = readPreviewReturnPath(route)
    if (!destination) return null
    url.searchParams.set("return_path", destination)
    if (logicalRoute) url.searchParams.set("return_path_kind", "logical")
  }
  return url.href
}

import { getUrlOrigin } from "@utils/get-url-origin"

export function getPreviewFrameUrl(previewUrl: string | undefined) {
  if (!previewUrl) return previewUrl

  const access = URL.parse(previewUrl)
  if (access && getUrlOrigin(previewUrl) !== access.origin) {
    const route = access.searchParams.get("route")
    if (!route) return previewUrl
    const fragmentStart = sectionFragmentStart(route)
    if (fragmentStart === -1) return previewUrl

    access.searchParams.set("route", route.slice(0, fragmentStart))
    return access.href
  }

  const fragmentStart = sectionFragmentStart(previewUrl)
  return fragmentStart === -1 ? previewUrl : previewUrl.slice(0, fragmentStart)
}

function sectionFragmentStart(previewUrl: string) {
  const fragmentStart = previewUrl.indexOf("#")
  if (fragmentStart === -1) return -1

  const fragment = previewUrl.slice(fragmentStart + 1)
  return fragment && !fragment.startsWith("/") && !fragment.startsWith("!") ? fragmentStart : -1
}

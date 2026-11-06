export function getPreviewFrameUrl(previewUrl: string | undefined) {
  if (!previewUrl) return previewUrl

  const fragmentStart = previewUrl.indexOf("#")
  if (fragmentStart === -1) return previewUrl

  const fragment = previewUrl.slice(fragmentStart + 1)
  return fragment && !fragment.startsWith("/") && !fragment.startsWith("!")
    ? previewUrl.slice(0, fragmentStart)
    : previewUrl
}

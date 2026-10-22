export function diagnosisPreviewUrl(value: unknown, expectedOrigin: string) {
  function invalid() {
    return Object.assign(new Error("Invalid controls diagnosis preview URL."), {
      statusCode: 400,
    })
  }
  if (
    typeof value !== "string" ||
    value.length > 8192 ||
    Array.from(value).some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    throw invalid()
  let url
  try {
    url = new URL(value)
  } catch {
    throw invalid()
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.origin !== expectedOrigin ||
    url.username ||
    url.password
  )
    throw invalid()
  for (const key of [...url.searchParams.keys()])
    if (key.startsWith("rc.")) url.searchParams.delete(key)
  const queryIndex = url.hash.indexOf("?")
  if (queryIndex !== -1) {
    const route = url.hash.slice(0, queryIndex)
    const query = new URLSearchParams(url.hash.slice(queryIndex + 1))
    for (const key of [...query.keys()]) if (key.startsWith("rc.")) query.delete(key)
    url.hash = `${route}${query.size ? `?${query.toString()}` : ""}`
  }
  return url.href
}

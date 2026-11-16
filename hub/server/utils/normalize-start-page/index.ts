const maximumBytes = 2048

function decodeLayer(value: string, firstPass: boolean): string | null {
  try {
    return decodeURIComponent(value.replace(/%(?![\da-f]{2})/gi, "%25"))
  } catch {
    if (firstPass) return null
    // A decoded literal percent may precede non-UTF-8 bytes. Decode the
    // remaining escapes so it cannot hide traversal or reserved paths.
    return value.replace(/(?:%[\da-f]{2})+/gi, (escaped) =>
      Buffer.from(escaped.replaceAll("%", ""), "hex").toString("utf8"),
    )
  }
}

/** Keeps a start page on its own preview host and away from reserved routes. */
export function normalizeStartPage(value: string): string | null {
  if (/[\p{Cc}\p{Cs}\p{Z}\\]/u.test(value)) return null
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) return null
  if (/%(?![\da-f]{2})/i.test(value)) return null

  const startPage = value.startsWith("/") ? value : `/${value}`
  if (startPage.startsWith("//") || Buffer.byteLength(startPage) > maximumBytes) return null

  let decodedPage = startPage
  let path = startPage.split(/[?#]/, 1)[0] ?? ""
  let firstPass = true
  // Check every decoding layer so encoded traversal cannot bypass the boundary.
  for (;;) {
    if (/[\p{Cc}\p{Cs}\\]/u.test(decodedPage)) return null
    if (path.startsWith("//")) return null
    if (path.split("/").some((segment) => [".", "..", ".replica-internal"].includes(segment)))
      return null
    const effectivePath = path.split(/[?#]/, 1)[0] ?? ""
    if (
      effectivePath.split("/").some((segment) => [".", "..", ".replica-internal"].includes(segment))
    )
      return null
    if (/^\/__replica(?:\/|[?#]|$)/i.test(path)) return null
    const nextPage = decodeLayer(decodedPage, firstPass)
    const nextPath = decodeLayer(path, firstPass)
    if (nextPage === null || nextPath === null) return null
    if (nextPage === decodedPage && nextPath === path) return startPage
    decodedPage = nextPage
    path = nextPath
    firstPass = false
  }
}

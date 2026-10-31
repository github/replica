/** Returns true when a path segment uses an unsupported character or reserved name. */
export function unsupportedPathSegment(segment: string) {
  const windowsName = segment.split(".", 1)[0].toUpperCase()

  return (
    segment === "" ||
    segment === "." ||
    !/^[\x20-\x7e]+$/.test(segment) ||
    /[<>:"|?*]/.test(segment) ||
    /[ .]$/.test(segment) ||
    /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(windowsName)
  )
}

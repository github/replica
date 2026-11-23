export function normalizeBasePath(value = "/") {
  if (value === "/") return value
  if (!/^\/previews\/github\/[1-9]\d{0,18}\/[1-9]\d{0,18}\/$/.test(value)) {
    throw new Error("base-path must be the canonical private preview path with a trailing slash.")
  }
  return value
}

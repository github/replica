export function normalizeBasePath(value = "/") {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    /[\s\\%?#\p{Cc}]/u.test(value) ||
    (value
      .slice(1)
      .replace(/\/$/, "")
      .split("/")
      .some((part) => [".", "..", ""].includes(part)) &&
      value !== "/")
  )
    throw new Error(
      "base-path must be a root-relative path without empty or encoded segments, query, or fragment.",
    )
  return value.endsWith("/") ? value : `${value}/`
}

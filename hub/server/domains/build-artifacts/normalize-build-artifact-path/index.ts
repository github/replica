const maximumPathBytes = 2_048

export function normalizeBuildArtifactPath(value: string): string | null {
  if (
    !value ||
    value.startsWith("/") ||
    value.includes("\\") ||
    Buffer.byteLength(value) > maximumPathBytes
  ) {
    return null
  }
  const segments = value.split("/")
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        segment === ".replica-internal" ||
        /[\p{Cc}\p{Cs}]/u.test(segment),
    )
  ) {
    return null
  }
  return segments.join("/")
}

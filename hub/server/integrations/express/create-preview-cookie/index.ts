export function createPreviewCookie(input: {
  value: string
  expiresAt: Date
  secure: boolean
}): string {
  return [
    `replica_preview=${encodeURIComponent(input.value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=None",
    input.secure ? "Secure" : null,
    `Expires=${input.expiresAt.toUTCString()}`,
  ]
    .filter(Boolean)
    .join("; ")
}

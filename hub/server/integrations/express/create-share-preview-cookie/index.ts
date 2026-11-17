export function createSharePreviewCookie(input: {
  value: string
  expiresAt: Date
  secure: boolean
}) {
  return [
    `replica_share_preview=${encodeURIComponent(input.value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    input.secure ? "Secure" : null,
    `Expires=${input.expiresAt.toUTCString()}`,
  ]
    .filter(Boolean)
    .join("; ")
}

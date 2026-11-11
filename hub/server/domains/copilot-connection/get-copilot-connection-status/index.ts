import { createHash } from "node:crypto"

export function getCopilotConnectionStatus(
  connection: {
    connectedBy: {
      login: string | null
      membershipId: string
      name: string | null
    }
    refusedAt: Date | null
    tokenDigest: string
    verifiedAt: Date
  } | null,
  token: string | null,
  connectedByIsAdministrator: boolean,
) {
  const tokenDigest = token ? createHash("sha256").update(token).digest("hex") : null
  const matchesVerifiedToken = Boolean(connection && tokenDigest === connection.tokenDigest)
  const connected = Boolean(
    connection && matchesVerifiedToken && connectedByIsAdministrator && !connection.refusedAt,
  )
  return {
    configured: tokenDigest !== null,
    connected,
    connectedBy:
      connection && matchesVerifiedToken && connectedByIsAdministrator
        ? connection.connectedBy
        : null,
    refusedAt: matchesVerifiedToken ? (connection?.refusedAt ?? null) : null,
    verifiedAt: matchesVerifiedToken ? (connection?.verifiedAt ?? null) : null,
  }
}

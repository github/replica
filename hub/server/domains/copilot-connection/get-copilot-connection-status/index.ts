import type { CopilotCredentialProviderKey } from "../../copilot-credentials/types.ts"

export function getCopilotConnectionStatus(
  connection: {
    connectedBy: {
      login: string | null
      membershipId: string
      name: string | null
    }
    credentialDigest: string
    credentialProvider: string
    refusedAt: Date | null
    verifiedAt: Date
  } | null,
  credentialProvider: {
    configurationDigest: string | null
    key: CopilotCredentialProviderKey
  },
  connectedByIsAdministrator: boolean,
) {
  const matchesVerifiedCredential = Boolean(
    connection &&
    credentialProvider.configurationDigest === connection.credentialDigest &&
    credentialProvider.key === connection.credentialProvider,
  )
  const connected = Boolean(
    connection && matchesVerifiedCredential && connectedByIsAdministrator && !connection.refusedAt,
  )
  return {
    configured: credentialProvider.configurationDigest !== null,
    connected,
    connectedBy:
      connection && matchesVerifiedCredential && connectedByIsAdministrator
        ? connection.connectedBy
        : null,
    refusedAt: matchesVerifiedCredential ? (connection?.refusedAt ?? null) : null,
    verifiedAt: matchesVerifiedCredential ? (connection?.verifiedAt ?? null) : null,
  }
}

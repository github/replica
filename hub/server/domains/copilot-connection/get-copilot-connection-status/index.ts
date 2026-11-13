import type {
  CopilotCredentialProviderKey,
  GitHubAppInstallationIdentity,
} from "../../copilot-credentials/types.ts"

export function getCopilotConnectionStatus(
  connection: {
    connectedBy: {
      login: string | null
      membershipId: string
      name: string | null
    }
    credentialDigest: string
    credentialProvider: string
    verifiedAt: Date
  } | null,
  credentialProvider: {
    configurationDigest: string | null
    githubAppInstallation?: GitHubAppInstallationIdentity | null
    key: CopilotCredentialProviderKey
  },
  connectedByIsAdministrator: boolean,
  refusal: {
    credentialDigest: string | null
    credentialProvider: string | null
    refusedAt: Date | null
  },
) {
  const matchesVerifiedCredential = Boolean(
    connection &&
    credentialProvider.configurationDigest === connection.credentialDigest &&
    credentialProvider.key === connection.credentialProvider,
  )
  const matchesRefusedCredential = Boolean(
    credentialProvider.configurationDigest &&
    credentialProvider.configurationDigest === refusal.credentialDigest &&
    credentialProvider.key === refusal.credentialProvider,
  )
  const connected = Boolean(
    connection &&
    matchesVerifiedCredential &&
    connectedByIsAdministrator &&
    !matchesRefusedCredential,
  )
  return {
    configured: credentialProvider.configurationDigest !== null,
    connected,
    savedConnection: connection !== null,
    credentialIdentity: credentialProvider.githubAppInstallation ?? null,
    connectedBy:
      connection && matchesVerifiedCredential && connectedByIsAdministrator
        ? connection.connectedBy
        : null,
    refusedAt: matchesRefusedCredential ? refusal.refusedAt : null,
    verifiedAt: matchesVerifiedCredential ? (connection?.verifiedAt ?? null) : null,
  }
}

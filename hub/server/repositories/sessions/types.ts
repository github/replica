export interface HubSession {
  id: string
  userId: string
  externalIdentityId: string
  authenticationProviderRevisionId: string
  tokenDigest: string
  signedInAt: Date
  freshAuthorizedAt: Date | null
}

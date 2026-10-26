export interface HubSession {
  id: string
  userId: string
  tokenDigest: string
  signedInAt: Date
  freshAuthorizedAt: Date | null
  credentialRevision: string
}

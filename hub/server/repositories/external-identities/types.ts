export interface ExternalIdentityInput {
  userId: string
  provider: string
  issuer: string
  subject: string
  username: string | null
  displayName: string | null
  avatarUrl: string | null
}

export interface HubExternalIdentity extends ExternalIdentityInput {
  id: string
}

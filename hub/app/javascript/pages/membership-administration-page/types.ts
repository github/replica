export interface MembershipIdentity {
  id: string
  provider: string
  issuer: string
  subject: string
  username: string | null
}

export interface MembershipRecord {
  id: string
  status: "active" | "suspended" | "removed"
  role: "member" | "administrator"
  user: {
    id: string
    displayName: string | null
    externalIdentities: MembershipIdentity[]
  }
}

export interface InvitationRecord {
  id: string
  provider: string
  issuer: string
  subject: string
  role: "member" | "administrator"
  expiresAt: string
  consumedAt: string | null
  revokedAt: string | null
}

export interface MembershipAdministrationPageProps {
  memberships: MembershipRecord[]
  invitations: InvitationRecord[]
  loading: boolean
  error: string | null
  onInvite: (input: {
    provider: string
    issuer: string
    subject: string
    role: "member" | "administrator"
  }) => void
  onChange: (
    membershipId: string,
    input: { role?: "member" | "administrator"; status?: "active" | "suspended" | "removed" },
  ) => void
  onRevokeInvitation: (invitationId: string) => void
  onSignIn: () => void
  onSignOut: () => void
}

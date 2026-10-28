export interface MembershipInvitationInput {
  createdByUserId: string | null
  provider: string
  issuer: string
  subject: string
  role: "member" | "administrator"
  expiresAt: Date
}

export interface MembershipInvitationRecord extends MembershipInvitationInput {
  id: string
  activatedIdentityId: string | null
  activatedMembershipId: string | null
  consumedAt: Date | null
  revokedAt: Date | null
  createdAt: Date
}

import type { IdentityStore } from "#server/domains/identity/create-store/types"
import type { InstallationMembershipRecord } from "#server/repositories/installation-memberships/types"
import type { MembershipInvitationRecord } from "#server/repositories/membership-invitations/types"

export interface AdministrationService {
  list(sessionToken: string): Promise<{
    memberships: unknown[]
    invitations: MembershipInvitationRecord[]
  }>
  invite(sessionToken: string, input: unknown): Promise<MembershipInvitationRecord>
  revokeInvitation(sessionToken: string, invitationId: string): Promise<void>
  changeMembership(
    sessionToken: string,
    membershipId: string,
    input: unknown,
  ): Promise<InstallationMembershipRecord>
}

export interface AdministrationDependencies {
  store: IdentityStore
  now: () => Date
}

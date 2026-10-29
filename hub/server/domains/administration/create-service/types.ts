import type { IdentityStore } from "#server/domains/identity/create-store/types"
import type {
  InstallationMembershipPage,
  InstallationMembershipRecord,
} from "#server/repositories/installation-memberships/types"
import type {
  MembershipInvitationPage,
  MembershipInvitationRecord,
} from "#server/repositories/membership-invitations/types"

export interface AdministrationService {
  list(
    sessionToken: string,
    cursors?: { memberships?: string | null; invitations?: string | null },
  ): Promise<{
    memberships: InstallationMembershipPage
    invitations: MembershipInvitationPage
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

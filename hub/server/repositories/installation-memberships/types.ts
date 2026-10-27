export interface InstallationMembershipInput {
  userId: string
  status: "active" | "suspended" | "removed"
  role: "member" | "administrator"
  source: "bootstrap" | "invitation" | "manual" | "recovery" | "synchronized"
  suspendedAt?: Date | null
  removedAt?: Date | null
}

export interface InstallationMembershipRecord {
  id: string
  userId: string
  status: InstallationMembershipInput["status"]
  role: InstallationMembershipInput["role"]
  source: InstallationMembershipInput["source"]
  suspendedAt: Date | null
  removedAt: Date | null
}

export interface InstallationMembershipDetails extends InstallationMembershipRecord {
  user: HubUser & { externalIdentities: HubExternalIdentity[] }
}
import type { HubExternalIdentity } from "#server/repositories/external-identities/types"
import type { HubUser } from "#server/repositories/users/types"

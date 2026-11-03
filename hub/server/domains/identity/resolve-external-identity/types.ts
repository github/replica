import type { ExternalIdentityTuple } from "../../../repositories/external-identities/find-external-identity/types.ts"

export interface ResolveExternalIdentityDependencies {
  findExternalIdentity(tuple: ExternalIdentityTuple): Promise<{ id: string; userId: string } | null>
}

export type ResolveExternalIdentityResult =
  { status: "absent" } | { status: "found"; externalIdentityId: string; userId: string }

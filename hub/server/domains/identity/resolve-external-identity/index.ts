import { z } from "zod"

import type { ExternalIdentityTuple } from "../../../repositories/external-identities/find-external-identity/types.ts"
import type { ResolveExternalIdentityDependencies, ResolveExternalIdentityResult } from "./types.ts"

const externalIdentityTupleSchema = z.object({
  provider: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,99}$/),
  issuer: z.string().min(1).max(500),
  subject: z.string().min(1).max(500),
})

export async function resolveExternalIdentity(
  input: ExternalIdentityTuple,
  dependencies: ResolveExternalIdentityDependencies,
): Promise<ResolveExternalIdentityResult> {
  const tuple = externalIdentityTupleSchema.parse(input)
  const identity = await dependencies.findExternalIdentity(tuple)

  return identity
    ? { status: "found", externalIdentityId: identity.id, userId: identity.userId }
    : { status: "absent" }
}

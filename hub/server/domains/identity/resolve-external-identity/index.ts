import { parseExternalIdentityTuple } from "../parse-external-identity-tuple/index.ts"
import type { ResolveExternalIdentityDependencies, ResolveExternalIdentityResult } from "./types.ts"

export async function resolveExternalIdentity(
  input: unknown,
  dependencies: ResolveExternalIdentityDependencies,
): Promise<ResolveExternalIdentityResult> {
  const tuple = parseExternalIdentityTuple(input)
  const identity = await dependencies.findExternalIdentity(tuple)

  return identity
    ? { status: "found", externalIdentityId: identity.id, userId: identity.userId }
    : { status: "absent" }
}

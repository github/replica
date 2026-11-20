import type { CurrentSessionDependencies } from "../../auth/types.ts"
import { readProductSession } from "../read-product-session/index.ts"

type Viewer = NonNullable<Awaited<ReturnType<CurrentSessionDependencies["restore"]>>>

export async function readProductWithCurrentAuthority<Result>(
  initial: Viewer,
  cookie: string | null,
  session: CurrentSessionDependencies,
  read: (viewer: Viewer) => Promise<Result>,
): Promise<{ current: Viewer; result: Result } | null> {
  let result = await read(initial)
  let current = await readProductSession(cookie, session)
  if (
    !current ||
    current.membershipId !== initial.membershipId ||
    current.userId !== initial.userId ||
    current.externalIdentityId !== initial.externalIdentityId ||
    current.sessionProvider !== initial.sessionProvider
  ) {
    return null
  }
  // A role change can change the repositories visible to this session.
  if (current.role !== initial.role) {
    result = await read(current)
    const verified = await readProductSession(cookie, session)
    if (
      !verified ||
      verified.membershipId !== current.membershipId ||
      verified.userId !== current.userId ||
      verified.externalIdentityId !== current.externalIdentityId ||
      verified.sessionProvider !== current.sessionProvider ||
      verified.role !== current.role
    ) {
      return null
    }
    current = verified
  }
  return { current, result }
}

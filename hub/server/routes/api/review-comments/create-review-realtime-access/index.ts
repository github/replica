import { z } from "zod"

import { hashAuthenticationValue } from "../../../../domains/authentication/hash-authentication-value/index.ts"
import { readHubSessionCookie } from "../../../../integrations/express/read-hub-session-cookie/index.ts"
import type { RealtimeOptions } from "../../../../integrations/ws/types.ts"
import type { AuthenticationRouteDependencies } from "../../auth/types.ts"
import type { ProductRouteDependencies } from "../../product/types.ts"

const uuid = z.uuid()

export function readReviewChannel(channel: string) {
  const [type, repositoryId, prototypeId, extra] = channel.split(":")
  if (
    type !== "review" ||
    extra !== undefined ||
    !repositoryId ||
    !prototypeId ||
    !uuid.safeParse(repositoryId).success ||
    !uuid.safeParse(prototypeId).success
  )
    return null
  return { repositoryId, prototypeId }
}

export function createReviewRealtimeAccess(
  authentication: AuthenticationRouteDependencies,
  product: ProductRouteDependencies,
): Pick<
  RealtimeOptions<string>,
  "authenticate" | "authorizeSubscription" | "revalidateSubscriptions"
> {
  return {
    async authenticate(request, signal) {
      if (request.headers.origin !== authentication.signOut.applicationOrigin) return null
      const cookie = readHubSessionCookie(request, authentication.signOut.secureCookie)
      if (!cookie || signal.aborted) return null
      const digest = hashAuthenticationValue(cookie)
      const current = await authentication.currentSession.restore(digest)
      return current && !signal.aborted ? digest : null
    },
    async authorizeSubscription(digest, channel, signal) {
      const scope = readReviewChannel(channel)
      if (
        !scope ||
        signal.aborted ||
        !product.authorizeReviewAccess ||
        !product.isPrototypeReviewable
      )
        return false
      const current = await authentication.currentSession.restore(digest)
      if (!current || signal.aborted) return false
      if (
        !(
          await product.authorizeReviewAccess(
            scope.repositoryId,
            { ...current, sessionDigest: digest },
            signal,
          )
        ).canView ||
        signal.aborted
      )
        return false
      if (
        !(await product.isPrototypeReviewable(scope.repositoryId, scope.prototypeId)) ||
        signal.aborted
      )
        return false
      const verified = await authentication.currentSession.restore(digest)
      return Boolean(
        verified &&
        verified.userId === current.userId &&
        verified.membershipId === current.membershipId &&
        verified.externalIdentityId === current.externalIdentityId &&
        verified.sessionProvider === current.sessionProvider &&
        verified.role === current.role &&
        !signal.aborted,
      )
    },
    revalidateSubscriptions: true,
  }
}

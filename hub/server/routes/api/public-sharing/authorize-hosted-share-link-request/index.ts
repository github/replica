import { PublicSharingError } from "../../../../domains/public-sharing/errors.ts"
import type { HostedSharingTarget } from "../../../../domains/public-sharing/types.ts"
import { GitHubProviderRequestError } from "../../../../integrations/github/errors.ts"
import type { CurrentSessionDependencies } from "../../auth/types.ts"
import { readProductSession } from "../../product/read-product-session/index.ts"
import type { ProductRouteDependencies } from "../../product/types.ts"
import type { PublicSharingRouteDependencies } from "../types.ts"

export async function authorizeHostedShareLinkRequest(
  input: HostedSharingTarget & {
    cookie: string
    initial: NonNullable<Awaited<ReturnType<CurrentSessionDependencies["restore"]>>>
    session: CurrentSessionDependencies
    product?: ProductRouteDependencies
    hosted: NonNullable<PublicSharingRouteDependencies["hosted"]>
  },
) {
  const { initial, cookie, session, product, hosted, repositoryId, prototypeId } = input
  const approval = await hosted.authorize({
    repositoryId,
    prototypeId,
    viewer: initial,
    getRepositoryPermission: async () => {
      const permission = await product?.getVerifiedRepositoryPermission?.(initial, repositoryId)
      if (!permission) throw new GitHubProviderRequestError()
      return permission
    },
  })

  const current = await readProductSession(cookie, session)
  if (
    !current ||
    current.membershipId !== initial.membershipId ||
    current.userId !== initial.userId ||
    current.sessionProvider !== initial.sessionProvider ||
    current.externalIdentityId !== approval.identity.id
  ) {
    throw new PublicSharingError("not_signed_in", "Sign in to continue.")
  }
  if (!product || !(await product.isRepositoryVisible(current, repositoryId))) {
    throw new PublicSharingError("not_found", "Prototype not found.")
  }
  return { approval, current }
}

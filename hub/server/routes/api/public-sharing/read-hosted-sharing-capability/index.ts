import { PublicSharingError } from "../../../../domains/public-sharing/errors.ts"
import { GitHubProviderRequestError } from "../../../../integrations/github/errors.ts"
import { authorizeHostedShareLinkRequest } from "../authorize-hosted-share-link-request/index.ts"

export async function readHostedSharingCapability(
  input: Omit<Parameters<typeof authorizeHostedShareLinkRequest>[0], "hosted"> & {
    hosted?: Parameters<typeof authorizeHostedShareLinkRequest>[0]["hosted"]
  },
) {
  if (!input.hosted) return {}
  try {
    await authorizeHostedShareLinkRequest({ ...input, hosted: input.hosted })
    return { canManageShareLinks: true }
  } catch (error) {
    if (error instanceof PublicSharingError || error instanceof GitHubProviderRequestError) {
      return { canManageShareLinks: false }
    }
    throw error
  }
}

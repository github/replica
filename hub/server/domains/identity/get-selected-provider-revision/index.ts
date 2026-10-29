import { z } from "zod"

import { ProviderRevisionInvariantError } from "../errors.ts"
import type { GetSelectedProviderRevisionDependencies } from "./types.ts"

const providerKeySchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,99}$/)

export async function getSelectedProviderRevision(
  providerKey: string,
  dependencies: GetSelectedProviderRevisionDependencies,
) {
  const provider = await dependencies.findAuthenticationProvider(
    providerKeySchema.parse(providerKey),
  )
  if (!provider) return null
  if (!provider.selectedRevision) {
    throw new ProviderRevisionInvariantError(
      "The authentication provider does not have a selected revision.",
    )
  }
  if (provider.selectedRevision.providerId !== provider.id) {
    throw new ProviderRevisionInvariantError(
      "The selected revision does not belong to the authentication provider.",
    )
  }
  return provider.selectedRevision
}

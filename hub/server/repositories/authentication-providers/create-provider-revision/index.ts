import type { AuthenticationProviderInput } from "#server/repositories/authentication-providers/types"

import type { Prisma } from "../../../generated/prisma/client.ts"

export async function createAuthenticationProviderRevision(
  database: Prisma.TransactionClient,
  input: AuthenticationProviderInput,
) {
  const provider = await database.authenticationProvider.upsert({
    where: { key: input.key },
    create: { key: input.key, type: input.type, enabled: input.enabled },
    update: { type: input.type, enabled: input.enabled },
  })
  return database.authenticationProviderRevision.create({
    data: {
      authenticationProviderId: provider.id,
      revision: input.revision,
      issuer: input.issuer,
      configuration: input.configuration,
    },
    include: { authenticationProvider: true },
  })
}

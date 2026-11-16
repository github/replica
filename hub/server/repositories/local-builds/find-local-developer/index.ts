import type { PrismaClient } from "../../../generated/prisma/client.ts"

import { localDeveloperIdentity } from "../../../domains/authentication/create-local-user-authentication-adapter/constants.ts"

export async function findLocalDeveloper(database: PrismaClient) {
  return await database.externalIdentity.findUnique({
    where: { provider_issuer_subject: localDeveloperIdentity },
    select: { userId: true },
  })
}

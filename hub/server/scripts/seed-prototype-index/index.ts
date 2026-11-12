import "dotenv/config"
import { z } from "zod"

import { localDeveloperIdentity } from "../../domains/authentication/create-local-user-authentication-adapter/constants.ts"
import { isLocalDevelopmentDatabase } from "../../utils/is-local-development-database/index.ts"
import { seedPrototypeIndexData } from "./seed-prototype-index-data/index.ts"

if (!isLocalDevelopmentDatabase(process.env)) {
  throw new Error("The prototype seed requires a local development database.")
}
const requestedUserId = process.argv[2] ? z.uuid().parse(process.argv[2]) : undefined
const { prisma } = await import("../../integrations/prisma/index.ts")
// Local sign-in creates one known identity, so the seed can find it without asking.
const userId =
  requestedUserId ??
  (
    await prisma.externalIdentity.findUnique({
      where: { provider_issuer_subject: localDeveloperIdentity },
      select: { userId: true },
    })
  )?.userId
if (!userId) {
  await prisma.$disconnect()
  throw new Error("Sign in as the local developer first, or pass a Hub user ID.")
}

try {
  await seedPrototypeIndexData(prisma, userId)
  console.log("The local prototype index seed is ready.")
} finally {
  await prisma.$disconnect()
}

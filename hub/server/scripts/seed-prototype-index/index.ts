import "dotenv/config"
import { z } from "zod"

import { isLocalDevelopmentDatabase } from "./is-local-development-database/index.ts"

if (!isLocalDevelopmentDatabase(process.env)) {
  throw new Error("The prototype seed requires a local development database.")
}
const userId = z.uuid().parse(process.argv[2])
const { prisma } = await import("../../integrations/prisma/index.ts")
const repository = {
  id: "00000000-0000-4000-8000-000000000101",
  nameWithOwner: "github/prototype",
  defaultBranch: "main",
  removedAt: null,
}
const prototypes = [
  {
    id: "00000000-0000-4000-8000-000000000201",
    repositoryId: repository.id,
    authorId: userId,
    branchName: "prototype/welcome",
    name: "Welcome",
    description: "Explore a new welcome page.",
  },
  {
    id: "00000000-0000-4000-8000-000000000202",
    repositoryId: repository.id,
    authorId: userId,
    branchName: "prototype/navigation",
    name: "Navigation",
    description: "Explore a different navigation layout.",
  },
]

try {
  await prisma.$transaction(async (database) => {
    const membership = await database.membership.findUnique({ where: { userId } })
    if (membership?.lifecycle !== "ACTIVE") throw new Error("Choose an active Hub member.")
    await database.repository.upsert({
      where: { id: repository.id },
      create: repository,
      update: repository,
    })
    // Rewriting every field lets a rerun restore samples edited during local testing.
    for (const prototype of prototypes) {
      const record = {
        ...prototype,
        registeredAt: new Date(),
        branchDeletedAt: null,
        replica: false,
      }
      await database.prototype.upsert({
        where: { id: prototype.id },
        create: record,
        update: record,
      })
    }
  })
  console.log("The local prototype index seed is ready.")
} finally {
  await prisma.$disconnect()
}

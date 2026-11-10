import "dotenv/config"
import { z } from "zod"

const databaseUrl = process.env.DATABASE_URL
const databaseAddress = databaseUrl ? URL.parse(databaseUrl) : null
if (
  process.env.NODE_ENV !== "development" ||
  !databaseAddress ||
  !["postgres:", "postgresql:"].includes(databaseAddress.protocol) ||
  !["127.0.0.1", "localhost", "[::1]", "db"].includes(databaseAddress.hostname)
) {
  throw new Error("The prototype seed requires a local development database.")
}
const userId = z.uuid().parse(process.argv[2])
const { prisma } = await import("../../integrations/prisma/index.ts")
const repositoryId = "00000000-0000-4000-8000-000000000101"

try {
  await prisma.$transaction(async (database) => {
    const membership = await database.membership.findUnique({ where: { userId } })
    if (membership?.lifecycle !== "ACTIVE") throw new Error("Choose an active Hub member.")
    const repository = await database.repository.upsert({
      where: { id: repositoryId },
      create: { id: repositoryId, nameWithOwner: "github/prototype", defaultBranch: "main" },
      update: {},
    })
    if (
      repository.nameWithOwner !== "github/prototype" ||
      repository.defaultBranch !== "main" ||
      repository.removedAt
    ) {
      throw new Error("The sample repository ID is already in use.")
    }
    await database.prototype.createMany({
      data: [
        {
          id: "00000000-0000-4000-8000-000000000201",
          repositoryId,
          authorId: userId,
          branchName: "prototype/welcome",
          name: "Welcome",
          description: "Explore a new welcome page.",
          registeredAt: new Date(),
        },
        {
          id: "00000000-0000-4000-8000-000000000202",
          repositoryId,
          authorId: userId,
          branchName: "prototype/navigation",
          name: "Navigation",
          description: "Explore a different navigation layout.",
          registeredAt: new Date(),
        },
      ],
      skipDuplicates: true,
    })
  })
  console.log("The local prototype index seed is ready.")
} finally {
  await prisma.$disconnect()
}

import "dotenv/config"
import { z } from "zod"

import { localDeveloperIdentity } from "../../domains/authentication/create-local-user-authentication-adapter/constants.ts"
import { isLocalDevelopmentDatabase } from "../../utils/is-local-development-database/index.ts"

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
  {
    id: "00000000-0000-4000-8000-000000000203",
    repositoryId: repository.id,
    authorId: userId,
    branchName: "prototype/running",
    name: "Running",
    description: "A prototype with a Build in progress.",
  },
  {
    id: "00000000-0000-4000-8000-000000000204",
    repositoryId: repository.id,
    authorId: userId,
    branchName: "prototype/failed",
    name: "Failed",
    description: "A prototype with a failed Build.",
  },
  {
    id: "00000000-0000-4000-8000-000000000205",
    repositoryId: repository.id,
    authorId: userId,
    branchName: "prototype/superseded",
    name: "Superseded",
    description: "A prototype with a superseded Build.",
  },
  {
    id: "00000000-0000-4000-8000-000000000206",
    repositoryId: repository.id,
    authorId: userId,
    branchName: "prototype/no-build",
    name: "No Build",
    description: "A prototype without a Build yet.",
  },
]
const builds = [
  {
    id: "00000000-0000-4000-8000-000000000301",
    prototypeId: "00000000-0000-4000-8000-000000000201",
    number: 1,
    state: "queued",
    workflowCreatedAt: null,
    createdAt: new Date("2026-11-10T12:00:00Z"),
  },
  {
    id: "00000000-0000-4000-8000-000000000302",
    prototypeId: "00000000-0000-4000-8000-000000000202",
    number: 2,
    state: "successful",
    workflowCreatedAt: new Date("2026-11-10T12:01:00Z"),
    createdAt: new Date("2026-11-10T12:02:00Z"),
  },
  {
    id: "00000000-0000-4000-8000-000000000303",
    prototypeId: "00000000-0000-4000-8000-000000000203",
    number: 3,
    state: "running",
    workflowCreatedAt: new Date("2026-11-10T12:03:00Z"),
    createdAt: new Date("2026-11-10T12:04:00Z"),
  },
  {
    id: "00000000-0000-4000-8000-000000000304",
    prototypeId: "00000000-0000-4000-8000-000000000204",
    number: 4,
    state: "failed",
    workflowCreatedAt: new Date("2026-11-10T12:05:00Z"),
    createdAt: new Date("2026-11-10T12:06:00Z"),
  },
  {
    id: "00000000-0000-4000-8000-000000000305",
    prototypeId: "00000000-0000-4000-8000-000000000205",
    number: 5,
    state: "superseded",
    workflowCreatedAt: null,
    createdAt: new Date("2026-11-10T12:07:00Z"),
  },
] as const

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
        currentBuildId: null,
      }
      await database.prototype.upsert({
        where: { id: prototype.id },
        create: record,
        update: record,
      })
    }
    for (const build of builds) {
      await database.build.upsert({
        where: { id: build.id },
        create: build,
        update: build,
      })
      await database.prototype.update({
        where: { id: build.prototypeId },
        data: { currentBuildId: build.id },
      })
    }
  })
  console.log("The local prototype index seed is ready.")
} finally {
  await prisma.$disconnect()
}

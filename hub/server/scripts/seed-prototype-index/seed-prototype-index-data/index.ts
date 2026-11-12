import type { PrismaClient } from "../../../generated/prisma/client.ts"

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
    branchName: "prototype/welcome",
    name: "Welcome",
    description: "Explore a new welcome page.",
  },
  {
    id: "00000000-0000-4000-8000-000000000202",
    repositoryId: repository.id,
    branchName: "prototype/navigation",
    name: "Navigation",
    description: "Explore a different navigation layout.",
  },
  {
    id: "00000000-0000-4000-8000-000000000203",
    repositoryId: repository.id,
    branchName: "prototype/running",
    name: "Running",
    description: "A prototype with a Build in progress.",
  },
  {
    id: "00000000-0000-4000-8000-000000000204",
    repositoryId: repository.id,
    branchName: "prototype/failed",
    name: "Failed",
    description: "A prototype with a failed Build.",
  },
  {
    id: "00000000-0000-4000-8000-000000000205",
    repositoryId: repository.id,
    branchName: "prototype/superseded",
    name: "Superseded",
    description: "A prototype with a superseded Build.",
  },
  {
    id: "00000000-0000-4000-8000-000000000206",
    repositoryId: repository.id,
    branchName: "prototype/no-build",
    name: "No Build",
    description: "A prototype without a Build yet.",
  },
]
const buildAuthor = {
  commitAuthorProvider: "local",
  commitAuthorIssuer: "local",
  commitAuthorProviderUserId: "sample-build-author",
  commitAuthorLogin: "sample-author",
  commitAuthorName: "Sample Author",
  commitAuthorAvatarUrl: null,
}
const builds = [
  {
    id: "00000000-0000-4000-8000-000000000301",
    prototypeId: "00000000-0000-4000-8000-000000000201",
    number: 1,
    state: "queued",
    workflowCreatedAt: null,
    createdAt: new Date("2026-11-10T12:00:00Z"),
    startedAt: null,
    finishedAt: null,
    failureSummary: null,
  },
  {
    id: "00000000-0000-4000-8000-000000000302",
    prototypeId: "00000000-0000-4000-8000-000000000202",
    number: 2,
    state: "successful",
    workflowCreatedAt: new Date("2026-11-10T12:01:00Z"),
    createdAt: new Date("2026-11-10T12:02:00Z"),
    startedAt: new Date("2026-11-10T12:02:10Z"),
    finishedAt: new Date("2026-11-10T12:03:00Z"),
    failureSummary: null,
  },
  {
    id: "00000000-0000-4000-8000-000000000303",
    prototypeId: "00000000-0000-4000-8000-000000000203",
    number: 3,
    state: "running",
    workflowCreatedAt: new Date("2026-11-10T12:03:00Z"),
    createdAt: new Date("2026-11-10T12:04:00Z"),
    startedAt: new Date("2026-11-10T12:04:10Z"),
    finishedAt: null,
    failureSummary: null,
  },
  {
    id: "00000000-0000-4000-8000-000000000304",
    prototypeId: "00000000-0000-4000-8000-000000000204",
    number: 4,
    state: "failed",
    workflowCreatedAt: new Date("2026-11-10T12:05:00Z"),
    createdAt: new Date("2026-11-10T12:06:00Z"),
    startedAt: new Date("2026-11-10T12:06:10Z"),
    finishedAt: new Date("2026-11-10T12:07:00Z"),
    failureSummary: "The sample Build failed.",
  },
  {
    id: "00000000-0000-4000-8000-000000000305",
    prototypeId: "00000000-0000-4000-8000-000000000205",
    number: 5,
    state: "superseded",
    workflowCreatedAt: null,
    createdAt: new Date("2026-11-10T12:07:00Z"),
    startedAt: null,
    finishedAt: new Date("2026-11-10T12:08:00Z"),
    failureSummary: null,
  },
] as const

export async function seedPrototypeIndexData(prisma: PrismaClient, userId: string) {
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
        authorId: userId,
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
      const record = {
        ...build,
        ...buildAuthor,
        commitSha: build.number.toString(16).padStart(40, "0"),
      }
      await database.build.upsert({
        where: { id: build.id },
        create: record,
        update: record,
      })
      await database.prototype.update({
        where: { id: build.prototypeId },
        data: { currentBuildId: build.id },
      })
    }
  })
}

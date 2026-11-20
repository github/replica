import "dotenv/config"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { createConfiguredArtifactStorage } from "../../domains/artifacts/create-configured-artifact-storage/index.ts"
import { createHubReviewCollection } from "../../domains/learning/create-hub-review-collection/index.ts"
import { prepareLearningStore } from "../../domains/learning/prepare-learning-store/index.ts"
import { readLearningConfiguration } from "../../domains/learning/read-learning-configuration/index.ts"
import { captureRepositoryReviewSnapshot } from "../../domains/review-comments/capture-repository-review-snapshot/index.ts"
import { runLearningCommand } from "../../integrations/learning/run-learning-command/index.ts"
import { localDeveloperIdentity } from "../../utils/local-developer-identity/index.ts"
import { isLocalDevelopmentDatabase } from "../../utils/is-local-development-database/index.ts"
import { createSolidPng } from "./create-solid-png/index.ts"

const repositoryId = "00000000-0000-4000-8000-000000000121"
const reviewerUserId = "00000000-0000-4000-8000-000000000122"
const reviewerProfileId = "00000000-0000-4000-8000-000000000123"
const prototypeIds = [
  "00000000-0000-4000-8000-000000000221",
  "00000000-0000-4000-8000-000000000222",
  "00000000-0000-4000-8000-000000000226",
  "00000000-0000-4000-8000-000000000230",
] as const
const buildIds = [
  "00000000-0000-4000-8000-000000000321",
  "00000000-0000-4000-8000-000000000322",
  "00000000-0000-4000-8000-000000000323",
  "00000000-0000-4000-8000-000000000324",
  "00000000-0000-4000-8000-000000000325",
  "00000000-0000-4000-8000-000000000326",
  "00000000-0000-4000-8000-000000000327",
  "00000000-0000-4000-8000-000000000328",
] as const
const threadIds = [
  "00000000-0000-4000-8000-000000000421",
  "00000000-0000-4000-8000-000000000422",
  "00000000-0000-4000-8000-000000000423",
  "00000000-0000-4000-8000-000000000424",
] as const
const commentIds = [
  "00000000-0000-4000-8000-000000000521",
  "00000000-0000-4000-8000-000000000522",
  "00000000-0000-4000-8000-000000000523",
  "00000000-0000-4000-8000-000000000524",
] as const
const resolutionIds = [
  "00000000-0000-4000-8000-000000000621",
  "00000000-0000-4000-8000-000000000622",
  "00000000-0000-4000-8000-000000000623",
  "00000000-0000-4000-8000-000000000624",
] as const

if (!isLocalDevelopmentDatabase(process.env)) {
  throw new Error("The decision-model walkthrough seed requires a local development database.")
}
if (process.env.ARTIFACT_STORAGE_PROVIDER !== "filesystem") {
  throw new Error("The decision-model walkthrough seed requires filesystem artifact storage.")
}
process.env.ARTIFACT_STORAGE_DIRECTORY ??= resolve("storage/decision-walkthrough-artifacts")

const { prisma } = await import("../../integrations/prisma/index.ts")
const localUserId = (
  await prisma.externalIdentity.findUnique({
    where: { provider_issuer_subject: localDeveloperIdentity },
    select: { userId: true },
  })
)?.userId
if (!localUserId) {
  await prisma.$disconnect()
  throw new Error("Sign in as the local developer before seeding the walkthrough.")
}
const localMembership = await prisma.membership.findUnique({
  where: { userId: localUserId },
  select: { id: true, lifecycle: true },
})
if (!localMembership || localMembership.lifecycle !== "ACTIVE") {
  await prisma.$disconnect()
  throw new Error("The local developer must have an active Hub membership.")
}

const storage = await createConfiguredArtifactStorage(process.env)
const learning = await readLearningConfiguration(process.env)
const preparedStore = await prepareLearningStore({
  applicationRoot: process.cwd(),
  repositoryKey: repositoryId,
  repositoryScope: `github.com/repositories/${repositoryId}`,
  root: learning.root,
  staticDirectories: learning.staticDirectories,
})
await rm(preparedStore.directory, { force: true, recursive: true })
const store = await prepareLearningStore({
  applicationRoot: process.cwd(),
  repositoryKey: repositoryId,
  repositoryScope: `github.com/repositories/${repositoryId}`,
  root: learning.root,
  staticDirectories: learning.staticDirectories,
})

const startedAt = new Date("2026-11-18T16:00:00.000Z")
const finishedAt = new Date("2026-11-18T16:05:00.000Z")
const fixedAt = new Date("2026-11-18T17:00:00.000Z")
const resolvedAt = new Date("2026-11-18T18:00:00.000Z")

await prisma.$transaction(async (database) => {
  await database.decisionBuildEvaluation.deleteMany({ where: { repositoryId } })
  await database.decisionModelPromotion.deleteMany({ where: { repositoryId } })
  await database.decisionCandidate.deleteMany({ where: { repositoryId } })
  await database.decisionTrainingJob.deleteMany({ where: { repositoryId } })
  await database.decisionRuntimeCopy.deleteMany({ where: { repositoryId } })
  await database.decisionRuntimeDeletion.deleteMany({ where: { repositoryId } })
  await database.decisionModelConfiguration.deleteMany({ where: { repositoryId } })
  await database.reviewThreadResolutionEvent.deleteMany({
    where: { threadId: { in: [...threadIds] } },
  })
  await database.reviewComment.deleteMany({ where: { threadId: { in: [...threadIds] } } })
  await database.reviewThread.deleteMany({ where: { id: { in: [...threadIds] } } })
  await database.buildArtifact.deleteMany({ where: { buildId: { in: [...buildIds] } } })
  await database.prototype.updateMany({
    where: { id: { in: [...prototypeIds] } },
    data: { currentBuildId: null },
  })
  await database.build.deleteMany({ where: { id: { in: [...buildIds] } } })
  await database.prototype.deleteMany({ where: { id: { in: [...prototypeIds] } } })

  await database.user.upsert({
    where: { id: reviewerUserId },
    create: { id: reviewerUserId },
    update: {},
  })
  await database.userProfile.upsert({
    where: { userId: reviewerUserId },
    create: {
      id: reviewerProfileId,
      userId: reviewerUserId,
      provider: "local",
      login: "mona",
      name: "Mona",
    },
    update: { provider: "local", login: "mona", name: "Mona" },
  })
  await database.repository.upsert({
    where: { id: repositoryId },
    create: {
      id: repositoryId,
      nameWithOwner: "local/decision-walkthrough",
      defaultBranch: "main",
      localPath: "/workspaces/replica/hub/.local/prototypes/decision-walkthrough",
    },
    update: {
      nameWithOwner: "local/decision-walkthrough",
      defaultBranch: "main",
      localPath: "/workspaces/replica/hub/.local/prototypes/decision-walkthrough",
      removedAt: null,
    },
  })
  await database.repositoryAccessGrant.upsert({
    where: {
      membershipId_repositoryId: {
        membershipId: localMembership.id,
        repositoryId,
      },
    },
    create: {
      membershipId: localMembership.id,
      repositoryId,
      accessLevel: "ADMIN",
      observedAt: new Date(),
    },
    update: { accessLevel: "ADMIN", observedAt: new Date() },
  })

  const prototypes = [
    { id: prototypeIds[0], branchName: "prototype/signup", name: "Signup" },
    { id: prototypeIds[1], branchName: "prototype/checkout", name: "Checkout" },
    { id: prototypeIds[2], branchName: "prototype/profile", name: "Profile" },
    { id: prototypeIds[3], branchName: "prototype/billing", name: "Billing" },
  ]
  for (const prototype of prototypes) {
    await database.prototype.create({
      data: {
        ...prototype,
        repositoryId,
        authorId: localUserId,
        description: "Synthetic decision-model walkthrough evidence.",
        registeredAt: startedAt,
        firstPublishedAt: startedAt,
      },
    })
  }

  const builds = [
    { id: buildIds[0], prototypeId: prototypeIds[0], number: 1, finishedAt },
    { id: buildIds[1], prototypeId: prototypeIds[0], number: 2, finishedAt: fixedAt },
    { id: buildIds[2], prototypeId: prototypeIds[1], number: 1, finishedAt },
    { id: buildIds[3], prototypeId: prototypeIds[1], number: 2, finishedAt: fixedAt },
    { id: buildIds[4], prototypeId: prototypeIds[2], number: 1, finishedAt },
    { id: buildIds[5], prototypeId: prototypeIds[2], number: 2, finishedAt: fixedAt },
    { id: buildIds[6], prototypeId: prototypeIds[3], number: 1, finishedAt },
    { id: buildIds[7], prototypeId: prototypeIds[3], number: 2, finishedAt: fixedAt },
  ]
  for (const [index, build] of builds.entries()) {
    await database.build.create({
      data: {
        ...build,
        state: "successful",
        commitSha: (index + 1).toString(16).padStart(40, "0"),
        authorProvider: "local",
        authorIssuer: "local",
        authorProviderUserId: "decision-walkthrough",
        authorLogin: "local-developer",
        authorName: "Local Developer",
        workflowCreatedAt: new Date(startedAt.getTime() + index * 10_000),
        startedAt: new Date(startedAt.getTime() + index * 10_000),
      },
    })
  }
  for (const [index, prototypeId] of prototypeIds.entries()) {
    await database.prototype.update({
      where: { id: prototypeId },
      data: { currentBuildId: buildIds[index * 2 + 1] },
    })
  }

  const localProfile = await database.userProfile.findUniqueOrThrow({
    where: { userId: localUserId },
  })
  const threads = [
    {
      id: threadIds[0],
      prototypeId: prototypeIds[0],
      buildId: buildIds[0],
      authorId: localUserId,
      authorLogin: localProfile.login,
      authorName: localProfile.name,
      body: "The email field uses placeholder text as its only label. Keep a visible label above every form field.",
    },
    {
      id: threadIds[1],
      prototypeId: prototypeIds[1],
      buildId: buildIds[2],
      authorId: reviewerUserId,
      authorLogin: "mona",
      authorName: "Mona",
      body: "The card number field loses its meaning after typing because the placeholder is the only label. Add a visible label.",
    },
    {
      id: threadIds[2],
      prototypeId: prototypeIds[2],
      buildId: buildIds[4],
      authorId: localUserId,
      authorLogin: localProfile.login,
      authorName: localProfile.name,
      body: "The display name input has no persistent label once it contains a value. Keep the label visible above it.",
    },
    {
      id: threadIds[3],
      prototypeId: prototypeIds[3],
      buildId: buildIds[6],
      authorId: reviewerUserId,
      authorLogin: "mona",
      authorName: "Mona",
      body: "The billing address inputs depend on placeholders. Add visible labels that remain after typing.",
    },
  ]
  for (const [index, thread] of threads.entries()) {
    await database.reviewThread.create({
      data: {
        id: thread.id,
        repositoryId,
        prototypeId: thread.prototypeId,
        buildId: thread.buildId,
        anchor: {
          schemaVersion: 1,
          kind: "element",
          route: { pathname: "/", search: "", hash: "" },
          accessibleName: index === 0 ? "Email" : "Card number",
          tagName: "input",
          selectedText: "",
          selector: index === 0 ? "#email" : "#card-number",
          rect: { x: 120, y: 180, width: 360, height: 44 },
          viewport: { width: 1440, height: 900, scrollX: 0, scrollY: 0 },
          elementOffset: { x: 0.5, y: 0.5 },
        },
        resolvedAt,
        resolvedById: thread.authorId,
      },
    })
    await database.reviewComment.create({
      data: {
        id: commentIds[index],
        threadId: thread.id,
        authorId: thread.authorId,
        authorLogin: thread.authorLogin,
        authorName: thread.authorName,
        body: thread.body,
        createdAt: new Date(startedAt.getTime() + index * 60_000),
      },
    })
    await database.reviewThreadResolutionEvent.create({
      data: {
        id: resolutionIds[index],
        threadId: thread.id,
        actorId: thread.authorId,
        sequence: 2,
        state: "RESOLVED",
        actorLogin: thread.authorLogin,
        actorName: thread.authorName,
        occurredAt: resolvedAt,
      },
    })
  }
})

const screenshotPaths = [
  ["screenshots/desktop.png", 1440, 900, [224, 240, 255]],
  ["screenshots/desktop-dark.png", 1440, 900, [24, 35, 54]],
  ["screenshots/narrow.png", 390, 844, [236, 253, 245]],
  ["screenshots/narrow-dark.png", 390, 844, [20, 46, 36]],
] as const
for (const [buildIndex, buildId] of buildIds.entries()) {
  for (const [path, width, height, color] of screenshotPaths) {
    const bytes = createSolidPng(
      width,
      height,
      color.map((value) => value + buildIndex * 3),
    )
    const storageKey = `decision_walkthrough_${buildIndex}_${path.replaceAll(/[^a-z]+/g, "_")}`
    const result = await storage.write(storageKey, bytes)
    if (result.status !== "ok" && result.status !== "already-exists") {
      throw new Error(`Could not seed ${path}: ${result.status}.`)
    }
    await prisma.buildArtifact.create({
      data: { buildId, kind: "screenshot", path, storageKey, byteLength: bytes.byteLength },
    })
  }
}

const snapshot = await captureRepositoryReviewSnapshot(prisma, repositoryId, resolvedAt)
const collection = createHubReviewCollection(snapshot, "http://127.0.0.1:5173").collection
const temporary = await mkdtemp(join(tmpdir(), "replica-decision-walkthrough-"))
try {
  const collectionPath = join(temporary, "reviews.json")
  const labelsPath = join(temporary, "labels.json")
  await writeFile(collectionPath, JSON.stringify(collection))
  const publicComments = await prisma.reviewComment.findMany({
    where: { id: { in: [...commentIds] } },
    orderBy: { createdAt: "asc" },
    select: { publicId: true },
  })
  await writeFile(
    labelsPath,
    JSON.stringify({
      labels: publicComments.map(({ publicId }) => ({
        target: { commentId: publicId },
        theme: {
          key: "visible-form-labels",
          statement: "Keep a visible label above every form field.",
        },
        signal: "accessibility",
        observation: "observed",
        stance: "supports",
        proposedKind: "rule",
      })),
    }),
  )
  const common = {
    cliPath: learning.cliPath,
    directory: process.cwd(),
    nodePath: learning.nodePath,
  }
  const scope = ["--dir", store.directory, "--repository", store.repositoryScope]
  const grant = (await runLearningCommand(
    [
      "grants",
      "add",
      "--purpose",
      "review",
      "--purpose",
      "instruction",
      "--purpose",
      "training",
      "--source",
      "hub_review_comments",
      "--basis",
      "Synthetic local decision-model walkthrough evidence.",
      "--by",
      "github:local-developer",
      ...scope,
    ],
    common,
  )) as { id: string }
  await runLearningCommand(
    [
      "import",
      "hub-comments",
      collectionPath,
      "--grant",
      grant.id,
      "--actor",
      "agent:walkthrough-seed",
      ...scope,
    ],
    common,
  )
  await runLearningCommand(
    [
      "label",
      labelsPath,
      "--actor",
      "agent:walkthrough-seed",
      "--model",
      "fixture-labeler",
      ...scope,
    ],
    common,
  )
  const consolidation = (await runLearningCommand(
    [
      "consolidate",
      "--from",
      "2026-11-01T00:00:00Z",
      "--to",
      "2026-11-19T00:00:00Z",
      "--actor",
      "agent:walkthrough-seed",
      ...scope,
    ],
    common,
  )) as { proposals: Array<{ id: string; reviewDigest: string }> }
  const proposal = consolidation.proposals[0]
  if (!proposal) throw new Error("The synthetic review evidence did not produce a learning.")
  await runLearningCommand(
    [
      "accept",
      proposal.id,
      "--digest",
      proposal.reviewDigest,
      "--by",
      "github:local-developer",
      "--note",
      "Accepted for the local decision-model walkthrough.",
      ...scope,
    ],
    common,
  )
} finally {
  await rm(temporary, { force: true, recursive: true })
  await prisma.$disconnect()
}

console.log(`The local decision-model walkthrough seed is ready in repository ${repositoryId}.`)

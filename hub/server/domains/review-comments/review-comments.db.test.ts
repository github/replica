import { randomUUID } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import { prisma } from "../../integrations/prisma"

import { captureRepositoryReviewSnapshot } from "./capture-repository-review-snapshot"
import { createReviewCommentService } from "./create-review-comment-service"
import type { ReviewCommentService } from "./types"

const sessionDigest = "a".repeat(64)

const anchor = {
  schemaVersion: 1 as const,
  kind: "element" as const,
  route: { pathname: "/checkout", search: "?step=delivery", hash: "#address" },
  selector: "#delivery-address",
  accessibleName: "Delivery address",
  tagName: "section",
  selectedText: "",
  rect: { x: 24, y: 120, width: 640, height: 240 },
  viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 40 },
  elementOffset: { x: 0.25, y: 0.5 },
}

const areaAnchor = {
  schemaVersion: 1 as const,
  kind: "area" as const,
  route: { pathname: "/profile", search: "", hash: "" },
  path: [
    { x: 0.1, y: 0.2 },
    { x: 0.8, y: 0.9 },
  ],
  rect: { x: 40, y: 80, width: 320, height: 180 },
  viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0 },
  elements: [
    {
      selector: "#profile-form",
      accessibleName: "Profile",
      tagName: "form",
      role: "form",
      textExcerpt: "Profile details",
      rect: { x: 40, y: 80, width: 320, height: 180 },
    },
  ],
}

async function createUser(login: string, name: string | null) {
  const user = await prisma.user.create({
    data: { profile: { create: { provider: "github", login, name } } },
  })
  return { userId: user.id, login, name }
}

async function createReviewablePrototype(
  repositoryId: string,
  branchName: string,
  buildNumber = 1,
) {
  const prototype = await prisma.prototype.create({
    data: {
      repositoryId,
      branchName,
      name: branchName,
      registeredAt: new Date("2026-11-01T00:00:00Z"),
    },
  })
  const build = await prisma.build.create({
    data: {
      prototypeId: prototype.id,
      number: buildNumber,
      state: "successful",
    },
  })
  return { prototype, build }
}

async function createRepository(nameWithOwner = "team/reviewable") {
  return prisma.repository.create({
    data: { nameWithOwner, defaultBranch: "main" },
  })
}

function createTestReviewService() {
  const service = createReviewCommentService(prisma)
  return {
    createThread: (
      input: Omit<Parameters<ReviewCommentService["createThread"]>[0], "sessionDigest">,
    ) => service.createThread({ ...input, sessionDigest }),
    createReply: (
      input: Omit<Parameters<ReviewCommentService["createReply"]>[0], "sessionDigest">,
    ) => service.createReply({ ...input, sessionDigest }),
    editComment: (
      input: Omit<Parameters<ReviewCommentService["editComment"]>[0], "sessionDigest">,
    ) => service.editComment({ ...input, sessionDigest }),
    deleteComment: (
      input: Omit<Parameters<ReviewCommentService["deleteComment"]>[0], "sessionDigest">,
    ) => service.deleteComment({ ...input, sessionDigest }),
    setResolution: (
      input: Omit<Parameters<ReviewCommentService["setResolution"]>[0], "sessionDigest">,
    ) => service.setResolution({ ...input, sessionDigest }),
    listPrototypeThreads: (repositoryId: string, prototypeId: string) =>
      service.listPrototypeThreads(repositoryId, prototypeId),
  }
}

describe("review comments", () => {
  it("stores stable root identity and flat replies without crossing prototype scope", async () => {
    const repository = await createRepository()
    const first = await createReviewablePrototype(repository.id, "prototype/checkout", 7)
    const second = await createReviewablePrototype(repository.id, "prototype/profile", 7)
    const author = await createUser("mona", "Mona Lisa")
    const reviewer = await createUser("hubot", "Hubot")
    const service = createTestReviewService()

    const thread = await service.createThread({
      repositoryId: repository.id,
      prototypeId: first.prototype.id,
      buildNumber: first.build.number,
      body: "Please align this section.",
      anchor,
      actor: author,
    })
    const replied = await service.createReply({
      repositoryId: repository.id,
      prototypeId: first.prototype.id,
      threadId: thread.id,
      body: "I updated the spacing.",
      actor: reviewer,
    })

    expect(thread.id).toEqual(expect.any(Number))
    expect(thread.id).toBeGreaterThan(0)
    expect(thread.root.id).toBe(thread.id)
    const storedRoot = await prisma.reviewComment.findUniqueOrThrow({
      where: { publicId: thread.root.id },
      select: { id: true, thread: { select: { id: true } } },
    })
    expect(storedRoot.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(storedRoot.thread.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(storedRoot.id).not.toBe(storedRoot.thread.id)
    expect(replied).toMatchObject({
      id: thread.id,
      repositoryId: repository.id,
      prototype: { id: first.prototype.id },
      buildNumber: 7,
      anchor,
      root: {
        id: thread.root.id,
        rootId: null,
        author,
      },
      replies: [
        {
          rootId: thread.root.id,
          author: reviewer,
          body: "I updated the spacing.",
        },
      ],
    })
    await expect(
      service.createReply({
        repositoryId: repository.id,
        prototypeId: second.prototype.id,
        threadId: thread.id,
        body: "Cross-prototype reply",
        actor: reviewer,
      }),
    ).rejects.toMatchObject({ code: "not_found" })

    await prisma.userProfile.update({
      where: { userId: author.userId },
      data: { login: "mona-renamed", name: "Renamed" },
    })
    const [listed] = await service.listPrototypeThreads(repository.id, first.prototype.id)
    expect(listed?.root.author).toEqual(author)
  })

  it("rejects invalid anchors, bodies, and unsuccessful or cross-prototype Builds", async () => {
    const repository = await createRepository()
    const first = await createReviewablePrototype(repository.id, "prototype/checkout", 1)
    const second = await createReviewablePrototype(repository.id, "prototype/profile", 2)
    const draft = await prisma.prototype.create({
      data: {
        repositoryId: repository.id,
        branchName: "prototype/draft",
      },
    })
    const draftBuild = await prisma.build.create({
      data: { prototypeId: draft.id, number: 1, state: "successful" },
    })
    const deleted = await createReviewablePrototype(repository.id, "prototype/deleted", 1)
    await prisma.prototype.update({
      where: { id: deleted.prototype.id },
      data: { branchDeletedAt: new Date("2026-11-15T00:00:00Z") },
    })
    const failed = await prisma.build.create({
      data: { prototypeId: first.prototype.id, number: 3, state: "failed" },
    })
    const author = await createUser("mona", "Mona")
    const service = createTestReviewService()

    const invalidInputs = [
      { body: " ", anchor },
      { body: "Contains \0 NUL", anchor },
      { body: "x".repeat(10_001), anchor },
      { body: "Unknown anchor field", anchor: { ...anchor, unknown: true } },
      {
        body: "NUL anchor",
        anchor: { ...anchor, route: { ...anchor.route, hash: "\0" } },
      },
      {
        body: "Invalid geometry",
        anchor: { ...anchor, rect: { ...anchor.rect, width: -1 } },
      },
    ]
    for (const invalid of invalidInputs) {
      await expect(
        service.createThread({
          repositoryId: repository.id,
          prototypeId: first.prototype.id,
          buildNumber: first.build.number,
          body: invalid.body,
          anchor: invalid.anchor,
          actor: author,
        }),
      ).rejects.toMatchObject({ code: "invalid" })
    }
    await expect(
      service.createThread({
        repositoryId: repository.id,
        prototypeId: first.prototype.id,
        buildNumber: failed.number,
        body: "Failed Build",
        anchor,
        actor: author,
      }),
    ).rejects.toMatchObject({ code: "not_found" })
    await expect(
      service.createThread({
        repositoryId: repository.id,
        prototypeId: first.prototype.id,
        buildNumber: second.build.number,
        body: "Other prototype",
        anchor,
        actor: author,
      }),
    ).rejects.toMatchObject({ code: "not_found" })
    await expect(
      service.createThread({
        repositoryId: repository.id,
        prototypeId: draft.id,
        buildNumber: draftBuild.number,
        body: "Draft branch",
        anchor,
        actor: author,
      }),
    ).rejects.toMatchObject({ code: "not_found" })
    await expect(
      service.createThread({
        repositoryId: repository.id,
        prototypeId: deleted.prototype.id,
        buildNumber: deleted.build.number,
        body: "Deleted branch",
        anchor,
        actor: author,
      }),
    ).rejects.toMatchObject({ code: "not_found" })
    await expect(service.listPrototypeThreads(repository.id, draft.id)).rejects.toMatchObject({
      code: "not_found",
    })
    await expect(
      service.listPrototypeThreads(repository.id, deleted.prototype.id),
    ).rejects.toMatchObject({ code: "not_found" })

    const nearLimit = structuredClone(areaAnchor)
    nearLimit.elements = Array.from({ length: 3 }, (_, index) => ({
      ...areaAnchor.elements[0]!,
      selector: `#${String(index)}${"x".repeat(3_500)}`,
      accessibleName: "a".repeat(1_000),
      textExcerpt: "t".repeat(500),
    }))
    expect(Buffer.byteLength(JSON.stringify(nearLimit), "utf8")).toBeGreaterThan(15_000)
    await expect(
      service.createThread({
        repositoryId: repository.id,
        prototypeId: first.prototype.id,
        buildNumber: first.build.number,
        body: "Near-limit anchor",
        anchor: nearLimit,
        actor: author,
      }),
    ).resolves.toMatchObject({ anchor: nearLimit })
  })

  it("rejects repository or prototype changes after the repeatable-read snapshot", async () => {
    const repository = await createRepository()
    const { prototype } = await createReviewablePrototype(repository.id, "prototype/checkout")
    const service = createTestReviewService()
    vi.spyOn(prisma.repository, "findFirst").mockResolvedValueOnce(null)

    await expect(service.listPrototypeThreads(repository.id, prototype.id)).rejects.toMatchObject({
      code: "not_found",
    })
  })

  it("hides soft-deleted text while retaining the source body and edit history", async () => {
    const repository = await createRepository()
    const { prototype, build } = await createReviewablePrototype(
      repository.id,
      "prototype/checkout",
    )
    const author = await createUser("mona", "Mona")
    const service = createTestReviewService()
    const thread = await service.createThread({
      repositoryId: repository.id,
      prototypeId: prototype.id,
      buildNumber: build.number,
      body: "Text that must be removed.",
      anchor,
      actor: author,
    })
    const replied = await service.createReply({
      repositoryId: repository.id,
      prototypeId: prototype.id,
      threadId: thread.id,
      body: "Keep my position.",
      actor: author,
    })
    const reply = replied.replies[0]
    if (!reply) throw new Error("Expected a reply")

    const edited = await service.editComment({
      repositoryId: repository.id,
      prototypeId: prototype.id,
      commentId: reply.id,
      body: "Edited source text.",
      actor: author,
    })
    const editedAt = edited.replies[0]?.editedAt
    expect(editedAt).toBeInstanceOf(Date)

    const deleted = await service.deleteComment({
      repositoryId: repository.id,
      prototypeId: prototype.id,
      commentId: reply.id,
      actor: author,
    })
    const deletedReply = deleted.replies[0]
    expect(deletedReply).toMatchObject({
      id: reply.id,
      rootId: thread.root.id,
      body: null,
      editedAt,
    })
    expect(deletedReply?.deletedAt).toBeInstanceOf(Date)
    const stored = await prisma.reviewComment.findUniqueOrThrow({
      where: { publicId: reply.id },
      select: { body: true, editedAt: true, deletedAt: true },
    })
    expect(stored).toEqual({
      body: "Edited source text.",
      editedAt,
      deletedAt: deletedReply?.deletedAt,
    })
    await expect(
      prisma.reviewComment.findUniqueOrThrow({
        where: { publicId: reply.id },
        select: { learningRedactionActor: true, learningRedactedAt: true },
      }),
    ).resolves.toEqual({
      learningRedactionActor: `human:${author.login}`,
      learningRedactedAt: null,
    })
    await expect(
      service.editComment({
        repositoryId: repository.id,
        prototypeId: prototype.id,
        commentId: reply.id,
        body: "Restored text",
        actor: author,
      }),
    ).rejects.toMatchObject({ code: "unprocessable" })

    const snapshot = await captureRepositoryReviewSnapshot(prisma, repository.id)
    expect(snapshot.threads[0]?.replies[0]).toMatchObject({
      id: reply.id,
      body: null,
      editedAt,
      deletedAt: deletedReply?.deletedAt,
    })
  })

  it("records only actual resolution transitions in order with each actor identity", async () => {
    const repository = await createRepository()
    const { prototype, build } = await createReviewablePrototype(
      repository.id,
      "prototype/checkout",
    )
    const author = await createUser("mona", "Mona")
    const firstReviewer = await createUser("hubot", "Hubot")
    const secondReviewer = await createUser("octocat", "The Octocat")
    const service = createTestReviewService()
    const thread = await service.createThread({
      repositoryId: repository.id,
      prototypeId: prototype.id,
      buildNumber: build.number,
      body: "Resolve this when fixed.",
      anchor,
      actor: author,
    })

    await service.setResolution({
      repositoryId: repository.id,
      prototypeId: prototype.id,
      threadId: thread.id,
      resolved: true,
      actor: firstReviewer,
    })
    await service.setResolution({
      repositoryId: repository.id,
      prototypeId: prototype.id,
      threadId: thread.id,
      resolved: true,
      actor: secondReviewer,
    })
    await service.setResolution({
      repositoryId: repository.id,
      prototypeId: prototype.id,
      threadId: thread.id,
      resolved: false,
      actor: secondReviewer,
    })
    await service.setResolution({
      repositoryId: repository.id,
      prototypeId: prototype.id,
      threadId: thread.id,
      resolved: false,
      actor: firstReviewer,
    })
    const resolvedAgain = await service.setResolution({
      repositoryId: repository.id,
      prototypeId: prototype.id,
      threadId: thread.id,
      resolved: true,
      actor: secondReviewer,
    })

    expect(resolvedAgain.resolutionHistory).toEqual([
      expect.objectContaining({ state: "resolved", actor: firstReviewer }),
      expect.objectContaining({ state: "reopened", actor: secondReviewer }),
      expect.objectContaining({ state: "resolved", actor: secondReviewer }),
    ])
    const sequences = resolvedAgain.resolutionHistory.map(({ sequence }) => sequence)
    expect(sequences).toEqual([...sequences].sort((first, second) => first - second))
    expect(new Set(sequences).size).toBe(3)
    expect(resolvedAgain.resolvedBy).toEqual(secondReviewer)
  })

  it("rejects every mutation after the prototype becomes hidden", async () => {
    const repository = await createRepository()
    const { prototype, build } = await createReviewablePrototype(
      repository.id,
      "prototype/checkout",
    )
    const author = await createUser("mona", "Mona")
    const reviewer = await createUser("hubot", "Hubot")
    const service = createTestReviewService()
    const thread = await service.createThread({
      repositoryId: repository.id,
      prototypeId: prototype.id,
      buildNumber: build.number,
      body: "Hide this branch.",
      anchor,
      actor: author,
    })
    await prisma.prototype.update({
      where: { id: prototype.id },
      data: { branchDeletedAt: new Date("2026-11-16T00:00:00Z") },
    })

    await expect(
      service.createReply({
        repositoryId: repository.id,
        prototypeId: prototype.id,
        threadId: thread.id,
        body: "Reply",
        actor: reviewer,
      }),
    ).rejects.toMatchObject({ code: "not_found" })
    await expect(
      service.editComment({
        repositoryId: repository.id,
        prototypeId: prototype.id,
        commentId: thread.root.id,
        body: "Edited",
        actor: author,
      }),
    ).rejects.toMatchObject({ code: "not_found" })
    await expect(
      service.deleteComment({
        repositoryId: repository.id,
        prototypeId: prototype.id,
        commentId: thread.root.id,
        actor: author,
      }),
    ).rejects.toMatchObject({ code: "not_found" })
    await expect(
      service.setResolution({
        repositoryId: repository.id,
        prototypeId: prototype.id,
        threadId: thread.id,
        resolved: true,
        actor: reviewer,
      }),
    ).rejects.toMatchObject({ code: "not_found" })
  })

  it("captures one complete repository snapshot and rejects removed repositories", async () => {
    const capturedAt = new Date("2026-11-13T18:00:00Z")
    const repository = await createRepository("team/snapshot")
    const first = await createReviewablePrototype(repository.id, "prototype/checkout", 4)
    const second = await createReviewablePrototype(repository.id, "prototype/profile", 9)
    const author = await createUser("mona", "Mona")
    const reviewer = await createUser("hubot", null)
    const service = createTestReviewService()
    const firstThread = await service.createThread({
      repositoryId: repository.id,
      prototypeId: first.prototype.id,
      buildNumber: first.build.number,
      body: "Checkout root",
      anchor,
      actor: author,
    })
    await service.createReply({
      repositoryId: repository.id,
      prototypeId: first.prototype.id,
      threadId: firstThread.id,
      body: "Checkout reply",
      actor: reviewer,
    })
    await service.setResolution({
      repositoryId: repository.id,
      prototypeId: first.prototype.id,
      threadId: firstThread.id,
      resolved: true,
      actor: reviewer,
    })
    await service.createThread({
      repositoryId: repository.id,
      prototypeId: second.prototype.id,
      buildNumber: second.build.number,
      body: "Profile root",
      anchor: areaAnchor,
      actor: reviewer,
    })

    const snapshot = await captureRepositoryReviewSnapshot(prisma, repository.id, capturedAt)

    expect(snapshot.snapshotId).toMatch(/^[0-9a-f-]{36}$/)
    expect(snapshot.capturedAt).toEqual(capturedAt)
    expect(snapshot.repository).toEqual({
      id: repository.id,
      nameWithOwner: "team/snapshot",
    })
    expect(snapshot.threads).toHaveLength(2)
    expect(snapshot.threads.every((thread) => Number.isInteger(thread.id))).toBe(true)
    expect(
      snapshot.threads.every(
        (thread) =>
          Number.isInteger(thread.root.id) &&
          thread.replies.every((reply) => Number.isInteger(reply.id)),
      ),
    ).toBe(true)
    const storedFirst = snapshot.threads.find(({ id }) => id === firstThread.id)
    expect(storedFirst).toMatchObject({ buildNumber: 4, anchor })
    expect(storedFirst?.root.author).toEqual(author)
    expect(storedFirst?.replies.map(({ author: replyAuthor }) => replyAuthor)).toEqual([reviewer])
    expect(storedFirst?.root.author.userId).toMatch(/^[0-9a-f-]{36}$/)
    expect(storedFirst?.replies[0]?.author.userId).toMatch(/^[0-9a-f-]{36}$/)
    expect(
      storedFirst?.resolutionHistory.map(({ state, actor }) => ({
        state,
        actor,
      })),
    ).toEqual([{ state: "resolved", actor: reviewer }])
    expect(storedFirst?.resolutionHistory[0]?.actor.userId).toMatch(/^[0-9a-f-]{36}$/)
    const storedSecond = snapshot.threads.find(({ buildNumber }) => buildNumber === 9)
    expect(storedSecond).toMatchObject({
      anchor: areaAnchor,
      prototype: {
        id: second.prototype.id,
        name: "prototype/profile",
        branch: "prototype/profile",
      },
    })

    await prisma.repository.update({
      where: { id: repository.id },
      data: { removedAt: new Date("2026-11-13T18:01:00Z") },
    })
    await expect(captureRepositoryReviewSnapshot(prisma, repository.id)).rejects.toMatchObject({
      code: "not_found",
    })
    await expect(captureRepositoryReviewSnapshot(prisma, randomUUID())).rejects.toMatchObject({
      code: "not_found",
    })
  })
})

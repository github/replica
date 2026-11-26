import { describe, expect, it } from "vitest"

import { prisma } from "../../../integrations/prisma"
import { findReviewThreadsWithComments } from "."

async function createCommentedRepository(input: {
  id: string
  githubRepositoryId: number | null
  removedAt?: Date
}) {
  await prisma.repository.create({
    data: {
      id: input.id,
      githubRepositoryId: input.githubRepositoryId,
      nameWithOwner: `team/${input.id}`,
      defaultBranch: "main",
      removedAt: input.removedAt ?? null,
    },
  })
  const author = await prisma.user.create({ data: {} })
  const prototype = await prisma.prototype.create({
    data: { repositoryId: input.id, branchName: "prototype" },
  })
  const build = await prisma.build.create({
    data: { prototypeId: prototype.id, number: 1, state: "successful" },
  })
  const thread = await prisma.reviewThread.create({
    data: {
      repositoryId: input.id,
      prototypeId: prototype.id,
      buildId: build.id,
      anchor: {
        schemaVersion: 1,
        kind: "element",
        route: { pathname: "/", search: "", hash: "" },
        selector: "#content",
        accessibleName: "Content",
        tagName: "main",
        selectedText: "",
        rect: { x: 0, y: 0, width: 100, height: 100 },
        viewport: { width: 1_000, height: 800, scrollX: 0, scrollY: 0 },
        elementOffset: { x: 0, y: 0 },
      },
      comments: { create: { authorId: author.id, authorLogin: "mona", body: "Evidence" } },
    },
    include: { comments: true },
  })
  return thread.comments[0]!.publicId
}

describe("findReviewThreadsWithComments()", () => {
  it("loads no evidence from a removed repository or, when required, one without a GitHub ID", async () => {
    const connectedId = "11111111-1111-4111-8111-111111111111"
    const removedId = "22222222-2222-4222-8222-222222222222"
    const localId = "33333333-3333-4333-8333-333333333333"
    const connectedComment = await createCommentedRepository({
      id: connectedId,
      githubRepositoryId: 101,
    })
    const removedComment = await createCommentedRepository({
      id: removedId,
      githubRepositoryId: 102,
      removedAt: new Date(),
    })
    const localComment = await createCommentedRepository({ id: localId, githubRepositoryId: null })

    expect(
      await findReviewThreadsWithComments(prisma, connectedId, [connectedComment], true),
    ).toHaveLength(1)
    expect(await findReviewThreadsWithComments(prisma, removedId, [removedComment], false)).toEqual(
      [],
    )
    expect(
      await findReviewThreadsWithComments(prisma, localId, [localComment], false),
    ).toHaveLength(1)
    expect(await findReviewThreadsWithComments(prisma, localId, [localComment], true)).toEqual([])
  })
})

import { describe, expect, it } from "vitest"

import { prisma } from "../../../integrations/prisma"
import { recordReviewerVerification } from "."

describe("recordReviewerVerification", () => {
  it("asks to score the Build that started last when the reviewer resolves their own thread", async () => {
    const repository = await prisma.repository.create({
      data: { defaultBranch: "main", githubRepositoryId: 31n, nameWithOwner: "octo/verified" },
    })
    const prototype = await prisma.prototype.create({
      data: { repositoryId: repository.id, branchName: "checkout" },
    })
    // Hub found Build 3's run late, so it started before Build 2.
    const builds = []
    for (const [number, day] of [
      [1, 1],
      [2, 3],
      [3, 2],
    ] as const) {
      builds.push(
        await prisma.build.create({
          data: {
            prototypeId: prototype.id,
            number,
            state: "successful",
            commitSha: String(number).repeat(40),
            workflowCreatedAt: new Date(`2026-12-0${day}T00:00:00Z`),
          },
        }),
      )
    }
    const reviewer = await prisma.user.create({ data: {} })
    const thread = await prisma.reviewThread.create({
      data: {
        repositoryId: repository.id,
        prototypeId: prototype.id,
        buildId: builds[0]!.id,
        anchor: { kind: "area", route: { pathname: "/" } },
        comments: {
          create: { authorId: reviewer.id, authorLogin: "reviewer", body: "Label the field." },
        },
      },
    })
    const verifiedAt = new Date("2026-12-04T00:00:00Z")

    await recordReviewerVerification(prisma, {
      threadId: thread.id,
      resolverId: reviewer.id,
      verifiedAt,
    })

    expect(
      await prisma.learningReviewerVerification.findMany({
        where: { repositoryId: repository.id },
        select: { prototypeId: true, commitSha: true, verifiedAt: true },
      }),
    ).toEqual([{ prototypeId: prototype.id, commitSha: "2".repeat(40), verifiedAt }])
    expect(
      await prisma.learningScoreRequest.findMany({
        where: { repositoryId: repository.id },
        select: { commitSha: true },
      }),
    ).toEqual([{ commitSha: "2".repeat(40) }])
  })

  it("ignores someone else resolving the thread and threads with no later Build", async () => {
    const repository = await prisma.repository.create({
      data: { defaultBranch: "main", githubRepositoryId: 32n, nameWithOwner: "octo/unverified" },
    })
    const prototype = await prisma.prototype.create({
      data: { repositoryId: repository.id, branchName: "checkout" },
    })
    const first = await prisma.build.create({
      data: {
        prototypeId: prototype.id,
        number: 1,
        state: "successful",
        commitSha: "1".repeat(40),
      },
    })
    const latest = await prisma.build.create({
      data: {
        prototypeId: prototype.id,
        number: 2,
        state: "successful",
        commitSha: "2".repeat(40),
      },
    })
    const reviewer = await prisma.user.create({ data: {} })
    const someoneElse = await prisma.user.create({ data: {} })
    async function createThread(buildId: string) {
      return prisma.reviewThread.create({
        data: {
          repositoryId: repository.id,
          prototypeId: prototype.id,
          buildId,
          anchor: { kind: "area", route: { pathname: "/" } },
          comments: {
            create: { authorId: reviewer.id, authorLogin: "reviewer", body: "Label the field." },
          },
        },
      })
    }
    const resolvedByOthers = await createThread(first.id)
    const onNewestBuild = await createThread(latest.id)

    await recordReviewerVerification(prisma, {
      threadId: resolvedByOthers.id,
      resolverId: someoneElse.id,
      verifiedAt: new Date(),
    })
    await recordReviewerVerification(prisma, {
      threadId: onNewestBuild.id,
      resolverId: reviewer.id,
      verifiedAt: new Date(),
    })

    expect(
      await prisma.learningReviewerVerification.count({ where: { repositoryId: repository.id } }),
    ).toBe(0)
    expect(
      await prisma.learningScoreRequest.count({ where: { repositoryId: repository.id } }),
    ).toBe(0)
  })
})

import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"

import { prisma } from "../../../integrations/prisma"
import { updateShareLinkExpirations } from "."

describe("updateShareLinkExpirations()", () => {
  it("does not let a stale update extend a previously shortened expiration", async () => {
    const user = await prisma.user.create({ data: {} })
    const repository = await prisma.repository.create({
      data: {
        defaultBranch: "main",
        localPath: `/prototype-root/${randomUUID()}`,
        nameWithOwner: "local/prototype",
      },
    })
    const prototype = await prisma.prototype.create({
      data: {
        branchName: "prototype/welcome",
        repositoryId: repository.id,
      },
    })
    const build = await prisma.build.create({
      data: {
        number: 1,
        prototypeId: prototype.id,
      },
    })
    const originalExpiration = new Date("2026-12-18T18:00:00.000Z")
    const link = await prisma.shareLink.create({
      data: {
        buildId: build.id,
        createdById: user.id,
        createdByLogin: "octocat",
        expiresAt: originalExpiration,
        label: "Review",
        prototypeId: prototype.id,
        publicId: randomUUID(),
      },
    })
    const shortenedExpiration = new Date("2026-11-19T18:00:00.000Z")
    const staleExpiration = new Date("2026-11-25T18:00:00.000Z")

    await updateShareLinkExpirations(prisma, [{ id: link.id, expiresAt: shortenedExpiration }])
    await updateShareLinkExpirations(prisma, [{ id: link.id, expiresAt: staleExpiration }])

    await expect(
      prisma.shareLink.findUniqueOrThrow({
        where: { id: link.id },
        select: { expiresAt: true },
      }),
    ).resolves.toEqual({ expiresAt: shortenedExpiration })
  })
})

import { describe, expect, it } from "vitest"

import { prisma } from "../../../integrations/prisma"
import { recordLearningUpdateRequest } from "../record-learning-update-request"
import { deleteLearningUpdateRequest } from "."

describe("deleteLearningUpdateRequest", () => {
  it("keeps a learning queued when a new score arrives while it is being checked", async () => {
    const repository = await prisma.repository.create({
      data: { nameWithOwner: "team/learning", defaultBranch: "main" },
    })
    const request = { repositoryId: repository.id, memoryId: "memory-1" }
    const seen = await recordLearningUpdateRequest(prisma, request)
    const latest = await recordLearningUpdateRequest(prisma, request)

    await deleteLearningUpdateRequest(prisma, seen)
    const kept = await prisma.learningUpdateRequest.count()
    await deleteLearningUpdateRequest(prisma, latest)

    expect([kept, await prisma.learningUpdateRequest.count()]).toEqual([1, 0])
  })
})

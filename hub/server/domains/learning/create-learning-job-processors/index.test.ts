import { describe, expect, it, vi } from "vitest"

import { deleteExpiredLearningRuns } from "../../../repositories/learning-runs/delete-expired-learning-runs"
import { createLearningJobProcessors } from "."

const prisma = { learningRun: {} }

vi.mock("../../../integrations/prisma", () => ({ prisma }))
vi.mock("../../../repositories/learning-runs/delete-expired-learning-runs", () => ({
  deleteExpiredLearningRuns: vi.fn().mockResolvedValue(undefined),
}))

describe("createLearningJobProcessors()", () => {
  it("prunes run history without initializing learning or Copilot when scheduling is disabled", async () => {
    const processors = createLearningJobProcessors(
      {
        DATABASE_URL: "postgresql://unused.example/replica",
        REPLICA_COPILOT_TOKEN: "would-require-explicit-authentication",
        REPLICA_LEARNING_AUTOMATIC_RUNS: "false",
        REPLICA_LEARNING_ROOT: "/would-be-rejected",
      },
      {} as never,
    )

    await expect(processors.schedule.process({})).resolves.toEqual({ scheduled: 0 })

    expect(deleteExpiredLearningRuns).toHaveBeenCalledOnce()
    expect(deleteExpiredLearningRuns).toHaveBeenCalledWith(prisma, expect.any(Date))
  })
})

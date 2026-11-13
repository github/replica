export async function claimLearningRun(
  database: {
    learningRun: {
      updateMany(input: {
        where: { id: string; state: "QUEUED" }
        data: { state: "RUNNING"; startedAt: Date }
      }): Promise<{ count: number }>
    }
  },
  runId: string,
  startedAt: Date,
) {
  const changed = await database.learningRun.updateMany({
    where: { id: runId, state: "QUEUED" },
    data: { state: "RUNNING", startedAt },
  })
  return changed.count === 1
}

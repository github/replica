export async function claimLearningRun(
  database: {
    learningRun: {
      updateMany(input: {
        where: { id: string; state: "QUEUED"; scheduled: boolean }
        data: { state: "RUNNING"; startedAt: Date }
      }): Promise<{ count: number }>
    }
  },
  runId: string,
  startedAt: Date,
  expectedScheduled: boolean,
) {
  const changed = await database.learningRun.updateMany({
    where: { id: runId, state: "QUEUED", scheduled: expectedScheduled },
    data: { state: "RUNNING", startedAt },
  })
  return changed.count === 1
}

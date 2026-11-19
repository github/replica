export async function recoverLearningRunJobs(dependencies: {
  list(): Promise<Array<{ id: string; scheduled: boolean }>>
  enqueueOnDemand(runId: string): Promise<unknown>
  enqueueScheduled(runId: string): Promise<unknown>
}) {
  for (const run of await dependencies.list()) {
    await (run.scheduled
      ? dependencies.enqueueScheduled(run.id)
      : dependencies.enqueueOnDemand(run.id))
  }
}

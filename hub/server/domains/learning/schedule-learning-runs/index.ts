export async function scheduleLearningRuns(dependencies: {
  automaticEnabled: boolean
  copilotUsable(): Promise<boolean>
  deleteExpired(cutoff: Date): Promise<unknown>
  listDue(): Promise<Array<{ id: string }>>
  capture(repositoryId: string): Promise<{ digest: string } | null>
  create(input: {
    repositoryId: string
    scheduled: true
    snapshotDigest: string
  }): Promise<{ run: { id: string }; created: boolean } | null>
  enqueue(runId: string): Promise<unknown>
  fail(runId: string, error: unknown): Promise<unknown>
  now(): Date
}) {
  const now = dependencies.now()
  await dependencies.deleteExpired(new Date(now.getTime() - 90 * 24 * 60 * 60 * 1_000))
  if (!dependencies.automaticEnabled) {
    return { scheduled: 0 }
  }
  if (!(await dependencies.copilotUsable())) {
    return { scheduled: 0 }
  }

  let scheduled = 0
  for (const repository of await dependencies.listDue()) {
    const snapshot = await dependencies.capture(repository.id)
    if (!snapshot) continue

    const result = await dependencies.create({
      repositoryId: repository.id,
      scheduled: true,
      snapshotDigest: snapshot.digest,
    })
    if (!result?.created) continue

    try {
      await dependencies.enqueue(result.run.id)
      scheduled += 1
    } catch (error) {
      await dependencies.fail(result.run.id, error)
    }
  }

  return { scheduled }
}

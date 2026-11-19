const automaticDispatchLimit = 100

type BaseDependencies = {
  deleteExpired: (cutoff: Date) => Promise<unknown>
  now: () => Date
}

type DisabledDependencies = BaseDependencies & {
  automaticEnabled: false
}

type EnabledDependencies = BaseDependencies & {
  automaticEnabled: true
  copilotUsable: () => Promise<boolean>
  listDue: () => Promise<Array<{ id: string }>>
  capture: (
    repositoryId: string,
  ) => Promise<{ digest: string; reviewActivitySnapshot: Record<string, number> } | null>
  create: (input: {
    repositoryId: string
    scheduled: true
    snapshotDigest: string
    reviewActivitySnapshot: Record<string, number>
  }) => Promise<{ run: { id: string }; created: boolean } | null>
  enqueue: (runId: string) => Promise<unknown>
  fail: (runId: string, error: unknown) => Promise<unknown>
  reportRepositoryFailure: (input: { repositoryId: string; errorType: string }) => void
}

export async function scheduleLearningRuns(
  dependencies: DisabledDependencies | EnabledDependencies,
) {
  const now = dependencies.now()
  await dependencies.deleteExpired(new Date(now.getTime() - 90 * 24 * 60 * 60 * 1_000))
  if (!dependencies.automaticEnabled) {
    return { scheduled: 0 }
  }
  if (!(await dependencies.copilotUsable())) {
    return { scheduled: 0 }
  }

  let scheduled = 0
  for (const repository of (await dependencies.listDue()).slice(0, automaticDispatchLimit)) {
    let snapshot: Awaited<ReturnType<EnabledDependencies["capture"]>>
    try {
      snapshot = await dependencies.capture(repository.id)
    } catch (error) {
      dependencies.reportRepositoryFailure({
        repositoryId: repository.id,
        errorType: error instanceof Error ? error.name : "UnknownError",
      })
      continue
    }
    if (!snapshot) continue

    let result: Awaited<ReturnType<EnabledDependencies["create"]>>
    try {
      result = await dependencies.create({
        repositoryId: repository.id,
        scheduled: true,
        snapshotDigest: snapshot.digest,
        reviewActivitySnapshot: snapshot.reviewActivitySnapshot,
      })
    } catch (error) {
      dependencies.reportRepositoryFailure({
        repositoryId: repository.id,
        errorType: error instanceof Error ? error.name : "UnknownError",
      })
      continue
    }
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

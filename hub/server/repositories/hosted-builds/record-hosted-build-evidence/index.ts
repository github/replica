import type { Prisma } from "../../../generated/prisma/client.ts"

interface CapturedOwner {
  id: string
  head: string | null
  currentBuildId: string | null
  deleted: boolean
  internal: boolean
}

interface RunEvidence {
  id: bigint
  attempt: number
  branchName: string
  commitSha: string
  createdAt: Date
  state: "queued" | "running" | "completed"
  conclusion: string | null
}

// All Build allocation for hosted repositories runs under the same repository row lock.
async function findOrCreateBuild(
  transaction: Prisma.TransactionClient,
  prototypeId: string,
  commitSha: string,
) {
  const existing = await transaction.build.findUnique({
    where: { prototypeId_commitSha: { prototypeId, commitSha } },
  })
  if (existing) return existing
  const { _max } = await transaction.build.aggregate({
    where: { prototypeId },
    _max: { number: true },
  })
  return transaction.build.create({
    data: { prototypeId, commitSha, number: (_max.number ?? 0) + 1 },
  })
}

export async function recordHostedBranchHeads(
  transaction: Prisma.TransactionClient,
  input: {
    repositoryId: string
    defaultBranch: string
    installationBranch: string
    owners: ReadonlyMap<string, CapturedOwner>
    heads: ReadonlyMap<string, string>
    retiredToResume: ReadonlySet<string>
  },
) {
  const now = new Date()
  for (const [branchName, commitSha] of input.heads) {
    const previous = input.owners.get(branchName)
    const internal = input.defaultBranch === branchName || previous?.internal === true
    const restore = previous?.deleted && input.retiredToResume.has(branchName)
    const existing = previous && (!previous.deleted || restore) ? previous : undefined
    const owner =
      existing ??
      (await transaction.prototype.create({
        data: { repositoryId: input.repositoryId, branchName, replica: internal },
        select: { id: true, currentBuildId: true },
      }))
    if (existing?.head === commitSha && !restore && existing.internal === internal) continue
    const build = await findOrCreateBuild(transaction, owner.id, commitSha)
    await transaction.prototype.update({
      where: { id: owner.id },
      data: {
        currentBuildId: build.id,
        branchDeletedAt: null,
        ...(internal ? { replica: true, registeredAt: null } : {}),
      },
    })
    await transaction.branchHeadObservation.upsert({
      where: {
        repositoryId_branchName_commitSha: {
          repositoryId: input.repositoryId,
          branchName,
          commitSha,
        },
      },
      create: {
        repositoryId: input.repositoryId,
        branchName,
        commitSha,
        buildId: build.id,
        lastObservedAt: now,
      },
      update: { buildId: build.id, lastObservedAt: now },
    })
  }
  const defaultOwner = input.owners.get(input.defaultBranch)
  if (!input.heads.has(input.defaultBranch) && input.defaultBranch !== input.installationBranch) {
    if (!defaultOwner || defaultOwner.deleted) {
      await transaction.prototype.create({
        data: { repositoryId: input.repositoryId, branchName: input.defaultBranch, replica: true },
      })
    } else if (!defaultOwner.internal) {
      await transaction.prototype.update({
        where: { id: defaultOwner.id },
        data: { replica: true, registeredAt: null },
      })
    }
  }
  const missing = [...input.owners].flatMap(([branch, owner]) =>
    !owner.deleted &&
    !owner.internal &&
    branch !== input.defaultBranch &&
    branch !== input.installationBranch &&
    !input.heads.has(branch)
      ? [owner.id]
      : [],
  )
  if (missing.length) {
    await transaction.prototype.updateMany({
      where: { id: { in: missing }, branchDeletedAt: null, replica: false },
      data: { branchDeletedAt: now },
    })
  }
  await transaction.repository.update({
    where: { id: input.repositoryId },
    data: { hostedBranchScan: { increment: 1 } },
  })
}

export async function recordHostedWorkflowRun(
  transaction: Prisma.TransactionClient,
  repositoryId: string,
  run: RunEvidence,
): Promise<"recorded" | "ignored" | "ambiguous"> {
  let build = await transaction.build.findUnique({
    where: { githubWorkflowRunId: run.id },
    include: { prototype: { select: { repositoryId: true, branchName: true } } },
  })
  if (
    build &&
    (build.prototype.repositoryId !== repositoryId ||
      build.prototype.branchName !== run.branchName ||
      build.commitSha !== run.commitSha ||
      build.workflowCreatedAt?.getTime() !== run.createdAt.getTime())
  )
    throw new Error("GitHub changed the identity of a saved workflow run.")

  if (!build) {
    // A workflow alone cannot create or restore an active branch owner.
    const second = Math.floor(run.createdAt.getTime() / 1000)
    const retired = await transaction.prototype.findFirst({
      where: {
        repositoryId,
        branchName: run.branchName,
        branchDeletedAt: { gte: new Date(second * 1000) },
      },
      orderBy: [{ branchDeletedAt: "asc" }, { id: "asc" }],
      select: { id: true, branchDeletedAt: true },
    })
    if (retired?.branchDeletedAt && Math.floor(retired.branchDeletedAt.getTime() / 1000) === second)
      return "ambiguous"
    const owner =
      retired ??
      (await transaction.prototype.findFirst({
        where: { repositoryId, branchName: run.branchName, branchDeletedAt: null },
        select: { id: true },
      }))
    if (!owner) return "ignored"
    build = {
      ...(await findOrCreateBuild(transaction, owner.id, run.commitSha)),
      prototype: { repositoryId, branchName: run.branchName },
    }
  }

  const sameRun = build.githubWorkflowRunId === run.id
  const newer = sameRun && run.attempt > (build.githubWorkflowRunAttempt ?? 0)
  if (
    (build.githubWorkflowRunId !== null && !sameRun) ||
    (sameRun && run.attempt < (build.githubWorkflowRunAttempt ?? 0))
  )
    return "ignored"
  if (
    build.state === "successful" ||
    build.state === "superseded" ||
    build.githubWorkflowCompletedAt ||
    (build.state === "failed" && !newer) ||
    (build.state === "running" && run.state === "queued" && !newer)
  )
    return sameRun && !newer ? "recorded" : "ignored"

  const now = new Date()
  const failed = run.state === "completed" && run.conclusion !== "success"
  const startedAt = run.state === "queued" ? null : (!newer && build.startedAt) || now
  await transaction.build.update({
    where: { id: build.id },
    data: {
      githubWorkflowRunId: run.id,
      githubWorkflowRunAttempt: run.attempt,
      workflowCreatedAt: run.createdAt,
      githubWorkflowCompletedAt: run.conclusion === "success" ? now : null,
      state: failed ? "failed" : run.state === "queued" ? "queued" : "running",
      startedAt,
      finishedAt: failed ? now : null,
      failureSummary: failed
        ? `GitHub Actions finished with ${run.conclusion?.replaceAll("_", " ")}.`
        : null,
    },
  })
  return "recorded"
}

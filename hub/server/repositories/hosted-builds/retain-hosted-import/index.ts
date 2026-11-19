import { randomUUID } from "node:crypto"

import type { Prisma } from "../../../generated/prisma/client.ts"

const leaseDurationMs = 15 * 60_000

export interface HostedImportIdentity {
  id: string
  prototypeId: string
  commitSha: string
  runId: bigint
  runAttempt: number
}

export interface HostedImportClaim extends HostedImportIdentity {
  leaseId: string
}

export interface RetainedHostedArtifact {
  path: string
  kind: "dist" | "screenshot" | "manifest"
  byteLength: number
  storageKey: string
}

function importable(build: HostedImportIdentity) {
  return {
    id: build.id,
    prototypeId: build.prototypeId,
    commitSha: build.commitSha,
    githubWorkflowRunId: build.runId,
    githubWorkflowRunAttempt: build.runAttempt,
    githubWorkflowCompletedAt: { not: null },
    state: "running",
  } as const
}

function activeClaim(claim: HostedImportClaim) {
  return {
    ...importable(claim),
    hostedImportLeaseId: claim.leaseId,
    hostedImportLeaseExpiresAt: { gt: new Date() },
  }
}

export async function claimHostedImport(
  transaction: Prisma.TransactionClient,
  build: HostedImportIdentity,
): Promise<HostedImportClaim | null> {
  const leaseId = randomUUID()
  const now = new Date()
  const { count } = await transaction.build.updateMany({
    where: {
      ...importable(build),
      OR: [{ hostedImportLeaseId: null }, { hostedImportLeaseExpiresAt: { lte: now } }],
    },
    data: {
      hostedImportLeaseId: leaseId,
      hostedImportLeaseExpiresAt: new Date(now.getTime() + leaseDurationMs),
    },
  })
  return count ? { ...build, leaseId } : null
}

export async function pinHostedArtifact(
  transaction: Prisma.TransactionClient,
  claim: HostedImportClaim,
  artifactId: bigint,
) {
  const { count } = await transaction.build.updateMany({
    where: {
      ...activeClaim(claim),
      OR: [{ githubArtifactId: null }, { githubArtifactId: artifactId }],
    },
    data: { githubArtifactId: artifactId },
  })
  return count === 1
}

export async function finishHostedImport(
  transaction: Prisma.TransactionClient,
  claim: HostedImportClaim,
  artifactId: bigint,
  artifacts: RetainedHostedArtifact[],
) {
  const { count } = await transaction.build.updateMany({
    where: { ...activeClaim(claim), githubArtifactId: artifactId },
    data: {
      state: "successful",
      finishedAt: new Date(),
      hostedImportLeaseId: null,
      hostedImportLeaseExpiresAt: null,
    },
  })
  if (!count) return false
  await transaction.buildArtifact.createMany({
    data: artifacts.map((artifact) => ({ ...artifact, buildId: claim.id })),
  })
  return true
}

/** Releasing this nonce prevents any in-flight publication from exposing the staging keys. */
export async function stopHostedImport(
  database: Pick<Prisma.TransactionClient, "build">,
  claim: HostedImportClaim,
  failureSummary?: string,
) {
  const { count } = await database.build.updateMany({
    where: { ...importable(claim), hostedImportLeaseId: claim.leaseId },
    data: {
      hostedImportLeaseId: null,
      hostedImportLeaseExpiresAt: null,
      ...(failureSummary ? { state: "failed", finishedAt: new Date(), failureSummary } : {}),
    },
  })
  return count === 1
}

import { createHash } from "node:crypto"

import { DecisionModelError } from "../errors.ts"
import type { PreparedDecisionTaskset } from "../types.ts"

export interface DecisionTasksetPreparationSource {
  exportTrainingEvidence(input: { repositoryId: string; actorMembershipId: string }): Promise<{
    bytes: Uint8Array
    consentGrantId: string | null
    digest: string
    repeatableReviewSnapshotDigest: string
  }>
  readBuildArtifacts(repositoryId: string): Promise<{
    bytes: Uint8Array
    digest: string
    complete: boolean
  }>
  createTaskset(input: { trainingExport: Uint8Array; builds: Uint8Array }): Promise<{
    archive: Uint8Array
    questionDigest: string
    tasksetDigest: string
  }>
}

function digest(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`
}

export async function prepareDecisionTaskset(
  input: { repositoryId: string; actorMembershipId: string },
  source: DecisionTasksetPreparationSource,
): Promise<PreparedDecisionTaskset> {
  const [trainingExport, builds] = await Promise.all([
    source.exportTrainingEvidence(input),
    source.readBuildArtifacts(input.repositoryId),
  ])
  if (!trainingExport.consentGrantId) {
    throw new DecisionModelError(
      409,
      "consent_required",
      "An active training-purpose consent grant is required.",
    )
  }
  if (
    digest(trainingExport.bytes) !== trainingExport.digest ||
    digest(builds.bytes) !== builds.digest
  ) {
    throw new DecisionModelError(
      409,
      "taskset_drift",
      "Decision-model preparation inputs failed their digest checks.",
    )
  }
  if (!builds.complete) {
    throw new DecisionModelError(409, "taskset_drift", "The Build screenshot set is incomplete.")
  }
  const taskset = await source.createTaskset({
    trainingExport: trainingExport.bytes,
    builds: builds.bytes,
  })
  if (digest(taskset.archive) !== taskset.tasksetDigest) {
    throw new DecisionModelError(
      409,
      "taskset_drift",
      "The prepared decision taskset failed its digest check.",
    )
  }
  return {
    bytes: taskset.archive,
    consentGrantId: trainingExport.consentGrantId,
    exportDigest: trainingExport.digest,
    repeatableReviewSnapshotDigest: trainingExport.repeatableReviewSnapshotDigest,
    questionDigest: taskset.questionDigest,
    buildSetDigest: builds.digest,
    tasksetDigest: taskset.tasksetDigest,
  }
}

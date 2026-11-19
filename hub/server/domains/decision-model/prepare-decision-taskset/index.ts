import { createHash } from "node:crypto"

import { DecisionModelError } from "../errors.ts"
import type { DecisionTrainingPreflight, PreparedDecisionTaskset } from "../types.ts"

export interface DecisionTasksetPreparationSource {
  preflight(input: {
    repositoryId: string
    actorMembershipId: string
  }): Promise<DecisionTrainingPreflight>
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
    upload: PreparedDecisionTaskset["upload"]
    questionDigest: string
    tasksetDigest: string
  }>
}

export function preflightDecisionTaskset(
  input: { repositoryId: string; actorMembershipId: string },
  source: DecisionTasksetPreparationSource,
) {
  return source.preflight(input)
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
  return {
    upload: taskset.upload,
    consentGrantId: trainingExport.consentGrantId,
    exportDigest: trainingExport.digest,
    repeatableReviewSnapshotDigest: trainingExport.repeatableReviewSnapshotDigest,
    questionDigest: taskset.questionDigest,
    buildSetDigest: builds.digest,
    tasksetDigest: taskset.tasksetDigest,
  }
}

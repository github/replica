import { resolve, sep } from "node:path"

import { isLocalDevelopmentDatabase } from "../../../utils/is-local-development-database/index.ts"

export function validateSeedEnvironment(
  environment: NodeJS.ProcessEnv,
  repositoryStore: string,
  learningRoot: string,
) {
  if (!isLocalDevelopmentDatabase(environment)) {
    throw new Error("The decision-model walkthrough seed requires a local development database.")
  }
  if (environment.ARTIFACT_STORAGE_PROVIDER !== "filesystem") {
    throw new Error("The decision-model walkthrough seed requires filesystem artifact storage.")
  }
  const root = resolve(learningRoot)
  const store = resolve(repositoryStore)
  if (!store.startsWith(`${root}${sep}`)) {
    throw new Error("The decision-model walkthrough store must stay inside REPLICA_LEARNING_ROOT.")
  }
}

export function validateResetState(activeJobs: number, runtimeGeneration: number) {
  if (activeJobs) {
    throw new Error("Stop the decision-model worker and active walkthrough jobs before reseeding.")
  }
  if (runtimeGeneration !== 0) {
    throw new Error(
      "Reset the dedicated fixture runtime state before reseeding the decision-model walkthrough.",
    )
  }
}

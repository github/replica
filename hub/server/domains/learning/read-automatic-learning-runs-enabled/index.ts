import { LearningConfigurationError } from "../errors.ts"

export function readAutomaticLearningRunsEnabled(environment: NodeJS.ProcessEnv) {
  const value = environment.REPLICA_LEARNING_AUTOMATIC_RUNS?.trim().toLowerCase()
  if (value !== undefined && value !== "true" && value !== "false") {
    throw new LearningConfigurationError("REPLICA_LEARNING_AUTOMATIC_RUNS must be true or false.")
  }
  return value === "true"
}

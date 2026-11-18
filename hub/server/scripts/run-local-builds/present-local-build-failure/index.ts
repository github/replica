import { LocalBuildPreconditionError } from "../../../domains/local-builds/errors.ts"
import {
  LocalDevelopmentConfigurationError,
  LocalDevelopmentPreparationError,
} from "../../../domains/local-development/errors.ts"

export function presentLocalBuildFailure(error: unknown): string {
  return error instanceof LocalBuildPreconditionError ||
    error instanceof LocalDevelopmentConfigurationError ||
    error instanceof LocalDevelopmentPreparationError
    ? error.message
    : "Local Build synchronization failed; check local mode, storage, Git, Docker, and build action dependencies."
}

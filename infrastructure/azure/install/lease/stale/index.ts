import { CommandExecutionError } from "../../../../installer/command/index.ts"

// Azure rejects a saved lease ID this way only when that lease is no longer held by it.
export function staleLeaseError(error: unknown): boolean {
  return (
    error instanceof CommandExecutionError &&
    !error.aborted &&
    /\bLease(?:IdMismatchWithLeaseOperation|NotPresentWithLeaseOperation)\b/.test(
      `${error.message}\n${error.details() ?? ""}`,
    )
  )
}

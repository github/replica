import type { RunCommand } from "../../types.ts"

// Uses the session signal only when the caller supplies none, so cleanup can outlive cancellation.
export function withDefaultSignal(run: RunCommand, signal: AbortSignal): RunCommand {
  return (executable, args, options) =>
    run(executable, args, { ...options, signal: options?.signal ?? signal })
}

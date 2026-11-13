import { CopilotConnectionError } from "../errors.ts"

export function createCopilotConnectionCheckLimit() {
  let running = false
  return async function withCopilotConnectionCheck<T>(operation: () => Promise<T>) {
    if (running) {
      throw new CopilotConnectionError("busy", "Another Copilot connection check is still running.")
    }
    running = true
    try {
      return await operation()
    } finally {
      running = false
    }
  }
}

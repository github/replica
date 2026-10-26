export const STARTUP_ERROR =
  "Could not start the dev server. Scan again, then retry or start it manually."
export const DESCRIPTION_ERROR =
  "Could not read dev scripts. Check package.json and start your server manually."

export class StartupError extends Error {}

export function publicStartupError(error: unknown, fallback = STARTUP_ERROR) {
  return error instanceof StartupError ? error.message : fallback
}

export type StartupStatus = { starting: boolean; message: string; output: string }

const publicStatuses = new WeakSet<object>()

export function createStartupStatus(status: StartupStatus) {
  // Only the manager's filtered messages may pass through the HTTP status projection.
  publicStatuses.add(status)
  return status
}

export function publicStartupStatus(status: {
  starting?: unknown
  message?: unknown
  output?: unknown
}) {
  return {
    starting: Boolean(status.starting),
    message:
      publicStatuses.has(status) && typeof status.message === "string"
        ? status.message
        : status.message
          ? STARTUP_ERROR
          : "",
    // Script output is intentionally visible, independently of exception filtering.
    output: typeof status.output === "string" ? status.output : "",
  }
}

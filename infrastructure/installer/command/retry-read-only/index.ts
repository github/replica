import { setTimeout as delay } from "node:timers/promises"

import type { RunCommand } from "../../types.ts"
import { CommandExecutionError } from "../index.ts"
import { describeCommand } from "../describe/index.ts"

const readOnly = new Set([
  "az.account.list",
  "az.account.show",
  "az.account.get-access-token",
  "az.provider.show",
  "az.postgres.flexible-server.list-skus",
  "az.group.exists",
  "az.group.show",
  "az.resource.list",
  "az.identity.show",
  "az.storage.account.list",
  "az.storage.account.show",
  "az.storage.container.list",
  "az.storage.blob.exists",
  "az.storage.blob.show",
  "az.storage.blob.list",
  "az.role.assignment.list",
  "az.keyvault.secret.list",
  "az.containerapp.job.execution.list",
  "az.containerapp.job.execution.show",
  "az.containerapp.job.list",
  "az.containerapp.job.show",
  "az.containerapp.list",
  "az.containerapp.show",
  "az.containerapp.env.show",
  "az.containerapp.revision.list",
  "az.containerapp.revision.show",
  "az.containerapp.replica.list",
  "terraform.state.list",
  "terraform.output",
])

const transient =
  /\b(?:ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|EPIPE)\b|timed out|socket hang up|connection (?:aborted|reset)|temporarily unavailable|TooManyRequests|Too Many Requests|ServiceUnavailable|Service Unavailable|InternalServerError|Internal Server Error|GatewayTimeout|Gateway Timeout|Bad Gateway|status(?: code)?[ :=]+(?:429|50[0234])\b/i

function isReadOnly(executable: string, args: string[]) {
  const { name } = describeCommand(executable, args)
  if (name === "az.rest") {
    const method = args.indexOf("--method")
    return method >= 0 && args[method + 1]?.toLowerCase() === "get"
  }
  return readOnly.has(name)
}

// Retries only known read-only commands after transient network or service errors.
export function retryReadOnly(
  run: RunCommand,
  { delays = [2_000, 5_000] }: { delays?: readonly number[] } = {},
): RunCommand {
  return async (executable, args, options) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await run(executable, args, options)
      } catch (error) {
        const details = error instanceof CommandExecutionError ? error.details() : undefined
        if (
          attempt >= delays.length ||
          !(error instanceof CommandExecutionError) ||
          error.aborted ||
          options?.signal?.aborted ||
          !details ||
          details.includes("Error details truncated after 64 KiB.") ||
          !transient.test(details) ||
          !isReadOnly(executable, args)
        )
          throw error
        await delay(delays[attempt], undefined, options?.signal && { signal: options.signal })
      }
    }
  }
}

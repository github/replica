import { CommandExecutionError } from "../index.ts"

export function transientFailure(error: unknown): error is CommandExecutionError {
  if (!(error instanceof CommandExecutionError) || error.aborted) return false
  const details = error.details()
  if (!details || details.includes("Error details truncated after 64 KiB.")) return false
  if (
    /AuthorizationFail(?:ed|ure)|AuthorizationPermissionMismatch|AuthenticationFailed|Forbidden|Unauthorized|InvalidAuthentication|AccessDenied|PermissionDenied|permission denied|do not have the required permissions|LeaseIdMismatch|LeaseAlreadyPresent|ResourceNotFound|ResourceGroupNotFound|prevent_destroy|contains resources|Error acquiring the state lock|Failed to (?:save|persist) state|\b(?:401|403)\b/i.test(
      details,
    )
  )
    return false
  const plain = details
    .split("\n")
    .map((line) => line.replace(/^[\s\u2502\u2575\u2577]+/, ""))
    .join("\n")
  const errors = plain.split(/(?:^|\n)Error:/i).filter((part) => part.trim())
  const transient =
    /\b(?:ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|EPIPE)\b|timed out|socket hang up|connection (?:aborted|reset)|temporarily unavailable|TooManyRequests|Too Many Requests|ServiceUnavailable|Service Unavailable|InternalServerError|Internal Server Error|GatewayTimeout|Gateway Timeout|Bad Gateway|status(?: code)?[ :=]+(?:429|50[0234])\b/i
  return errors.length > 0 && errors.every((part) => transient.test(part))
}

export type ApplyOutcome = {
  address?: string
  kind:
    | "connectivity"
    | "permission"
    | "conflict"
    | "ambiguous-write"
    | "state-not-saved"
    | "unknown"
}

const permission =
  /AuthorizationFailed|LinkedAuthorizationFailed|AuthorizationPermissionMismatch|AuthenticationFailed|InvalidAuthentication|Forbidden|Unauthorized|does not have (?:authorization|permission)|status(?: code)?[ :=]+40[13]\b|unexpected status 40[13]\b/i
const conflict =
  /RoleAssignmentExists|already exists|needs to be imported|status(?: code)?[ :=]+409\b|unexpected status 409\b/i
// Name resolution and connection setup fail before Azure receives the request.
const undelivered =
  /no such host|server misbehaving|\bENOTFOUND\b|\bEAI_AGAIN\b|connection refused|\bECONNREFUSED\b|\bdial tcp\b/i
const lostResponse =
  /connection reset|\bECONNRESET\b|\bEOF\b|broken pipe|\bEPIPE\b|socket hang up|i\/o timeout|timed out|context deadline exceeded|status(?: code)?[ :=]+50[0234]\b|unexpected status 50[0234]\b/i
const write =
  /^\s*(?:creating|updating|deleting|waiting for)\b|\b(?:PUT|PATCH|POST|DELETE)\s+"?https:\/\//im

// Classifies each Terraform apply error block; missing or truncated details are unknown.
export function applyOutcomes(details: string | undefined): ApplyOutcome[] {
  if (!details || details.includes("Error details truncated after 64 KiB."))
    return [{ kind: "unknown" }]
  const plain = details
    .split("\n")
    .map((line) => line.replace(/^[\s\u2502\u2575\u2577]+/, ""))
    .join("\n")
  const errors = plain.split(/(?:^|\n)Error:/).slice(1)
  if (!errors.length) return [{ kind: "unknown" }]
  return errors.map((error) => {
    const address = /\bwith\s+([^\s,]+),/.exec(error)?.[1]
    const kind: ApplyOutcome["kind"] = /Failed to (?:save|persist) state/i.test(error)
      ? "state-not-saved"
      : permission.test(error)
        ? "permission"
        : conflict.test(error)
          ? "conflict"
          : undelivered.test(error)
            ? "connectivity"
            : lostResponse.test(error)
              ? write.test(error)
                ? "ambiguous-write"
                : "connectivity"
              : "unknown"
    return address ? { address, kind } : { kind }
  })
}

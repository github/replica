import { expect, it } from "vitest"

import { CommandExecutionError } from "../index.ts"
import { transientFailure } from "./index.ts"

it("accepts multiple diagnostic blocks only when every error is transient", () => {
  const error = new CommandExecutionError(
    "Terraform read failed.",
    false,
    1,
    "╷\n│ Error: reading resource: ECONNRESET\n╵\n╷\n│ Error: Gateway Timeout\n╵",
  )

  expect(transientFailure(error)).toBe(true)
})

it("rejects a permanent diagnostic beside an otherwise transient error", () => {
  const error = new CommandExecutionError(
    "Terraform read failed.",
    false,
    1,
    "╷\n│ Error: reading resource: ECONNRESET\n╵\n╷\n│ Error: Unsupported argument\n╵",
  )

  expect(transientFailure(error)).toBe(false)
})

it.each([
  ["authorization", "(AuthorizationFailed) Request was denied."],
  ["permission", "Permission denied."],
  ["authentication", "(AuthenticationFailed) Credentials were rejected."],
  ["lease", "(LeaseIdMismatchWithBlobOperation) The lease ID does not match."],
  ["state lock", "Error acquiring the state lock."],
  ["state save", "Failed to save state."],
  ["not found", "(ResourceNotFound) Resource was not found."],
  ["deletion protection", "Resource has lifecycle.prevent_destroy set."],
  ["nonempty resource group", "Cannot delete resource group because it contains resources."],
])("rejects a %s failure even when it also reports a network timeout", (_kind, diagnostic) => {
  const error = new CommandExecutionError(
    "Command failed.",
    false,
    1,
    `${diagnostic}\nThe upstream connection timed out.`,
  )

  expect(transientFailure(error)).toBe(false)
})

import { leaseOwnership } from "../../install/lease/ownership/index.ts"
import { readBlobLease } from "../../install/lease/read/index.ts"
import type { RemovalLeaseError } from "../lease-error/index.ts"
import type { RemovalContext } from "../types.ts"

export async function recoverRemovalOperational(
  context: RemovalContext,
  observed: RemovalLeaseError,
  verify: () => Promise<void>,
): Promise<void> {
  const { account, container, blob } = observed.target
  const proof = await leaseOwnership(context, account, container, blob)
  if (proof.lease) return
  await verify()
  const value = await readBlobLease(context, account, container, blob)
  if (
    !value ||
    typeof value !== "object" ||
    !("status" in value) ||
    !("state" in value) ||
    !("duration" in value)
  )
    throw new Error("Operational lease metadata is unverifiable. Recovery stopped.")
  if (
    value.status === "unlocked" &&
    ["available", "broken", "expired"].includes(String(value.state))
  )
    return
  if (value.status !== "locked" || value.state !== "leased" || value.duration !== "infinite")
    throw new Error("Operational lease changed after removal preflight. Recovery stopped.")
  await context.azure(
    "storage",
    "blob",
    "lease",
    "break",
    "--account-name",
    account,
    "--container-name",
    container,
    "--blob-name",
    blob,
    "--auth-mode",
    "login",
    "--lease-break-period",
    "0",
  )
  const after = await readBlobLease(context, account, container, blob)
  if (
    !after ||
    typeof after !== "object" ||
    !("status" in after) ||
    after.status !== "unlocked" ||
    !("state" in after) ||
    !["available", "broken", "expired"].includes(String(after.state))
  )
    throw new Error("Operational lock recovery was not verified. No recovery retry was attempted.")
}

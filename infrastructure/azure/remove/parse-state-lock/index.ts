import { createHash } from "node:crypto"

export interface TerraformLockSnapshot {
  id: string
  fingerprint: string
}

export function parseTerraformLock(
  value: unknown,
  expectedPath: string,
): TerraformLockSnapshot | undefined {
  const record = (input: unknown): input is Record<string, unknown> =>
    input !== null && typeof input === "object" && !Array.isArray(input)
  function invalid(reason: string): never {
    throw new Error(`Terraform state recovery blocked: ${reason}. No state lock was released.`)
  }
  function timestamp(input: unknown): input is string {
    if (
      typeof input !== "string" ||
      !/^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(
        input,
      ) ||
      !Number.isFinite(Date.parse(input))
    )
      return false
    const date = input.slice(0, 10)
    const calendar = Date.parse(`${date}T00:00:00Z`)
    return Number.isFinite(calendar) && new Date(calendar).toISOString().slice(0, 10) === date
  }
  if (!record(value) || !record(value.lease)) invalid("current lease metadata is missing")
  const lease = value.lease
  if (
    lease.status === "unlocked" &&
    typeof lease.state === "string" &&
    ["available", "broken", "expired"].includes(lease.state)
  )
    return undefined
  if (lease.status !== "locked" || lease.state !== "leased" || lease.duration !== "infinite")
    invalid("the lease is finite, changing, or unknown")
  if (
    typeof value.lock !== "string" ||
    !value.lock ||
    value.lock.length > 16_384 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value.lock) ||
    Buffer.from(value.lock, "base64").toString("base64") !== value.lock
  )
    invalid("Terraform lock metadata is missing or malformed")
  let info: unknown
  try {
    info = JSON.parse(Buffer.from(value.lock, "base64").toString("utf8"))
  } catch {
    invalid("Terraform lock metadata is not valid JSON")
  }
  if (!record(info)) invalid("Terraform lock metadata is not an object")
  if (
    typeof info.ID !== "string" ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(info.ID)
  )
    invalid("the Terraform lock identifier is invalid")
  if (info.Path !== expectedPath) invalid("the lock belongs to another state path")
  if (
    typeof info.Who !== "string" ||
    !info.Who.trim() ||
    info.Who.length > 256 ||
    /[\u0000-\u001f\u007f]/.test(info.Who)
  )
    invalid("the lock owner is unidentified")
  if (
    typeof info.Operation !== "string" ||
    ![
      "OperationTypeApply",
      "OperationTypePlan",
      "OperationTypeRefresh",
      "OperationTypeImport",
      "OperationTypeDestroy",
    ].includes(info.Operation)
  )
    invalid("the Terraform operation is unrecognized")
  const version =
    typeof info.Version === "string"
      ? /^1\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(
          info.Version,
        )
      : null
  if (
    !version ||
    version[3]
      ?.split(".")
      .some((part) => /^\d+$/.test(part) && part.length > 1 && part.startsWith("0"))
  )
    invalid("the Terraform lock version is unsupported")
  if (!timestamp(info.Created)) invalid("the lock creation metadata is invalid")
  if (
    typeof value.etag !== "string" ||
    !value.etag ||
    value.etag.length > 512 ||
    /[\u0000-\u001f\u007f]/.test(value.etag) ||
    !timestamp(value.modified) ||
    typeof value.size !== "number" ||
    !Number.isSafeInteger(value.size) ||
    value.size <= 0
  )
    invalid("the existing state blob cannot be verified")
  return {
    id: info.ID,
    fingerprint: createHash("sha256")
      .update(JSON.stringify([value.lock, value.etag, value.modified, value.size]))
      .digest("hex"),
  }
}

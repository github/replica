import { expect, it } from "vitest"

import { parseTerraformLock } from "./index.ts"

const path = "terraform/sample-hub/app.tfstate"

function fixture() {
  const info = {
    ID: "00000000-0000-0000-0000-000000000003",
    Path: path,
    Who: "synthetic-operator@synthetic-host",
    Operation: "OperationTypeApply",
    Version: "1.13.4",
    Created: "2026-11-10T18:00:00.123456789Z",
  }
  const head = {
    lease: { status: "locked", state: "leased", duration: "infinite" },
    lock: Buffer.from(JSON.stringify(info)).toString("base64"),
    etag: '"synthetic-state-etag"',
    modified: "2026-11-10T18:00:00.000Z",
    size: 128,
  }
  return { info, head }
}

it("reads the actual padded Terraform LockInfo protocol without treating age as proof of staleness", () => {
  const { info, head } = fixture()
  for (const Created of ["2026-11-10T18:00:00.123456789Z", "2000-01-01T00:00:00+00:00"]) {
    const snapshot = parseTerraformLock({
      ...head,
      lock: Buffer.from(JSON.stringify({ ...info, Created })).toString("base64"),
    }, path)
    expect(snapshot).toEqual({ id: info.ID, fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) })
  }
  expect(parseTerraformLock(head, path)).toEqual(parseTerraformLock({ ...head }, path))
})

it("skips only explicitly verified unlocked terminal lease states", () => {
  for (const state of ["available", "broken", "expired"])
    expect(parseTerraformLock({
      lease: { status: "unlocked", state, duration: null },
    }, path)).toBeUndefined()
  for (const lease of [
    { status: "unlocked", state: "leased" },
    { status: "unlocked", state: ["available"] },
    { status: "locked", state: "available", duration: "infinite" },
    { status: "locked", state: "leased", duration: "fixed" },
    { status: "locked", state: "breaking", duration: "infinite" },
    null,
  ])
    expect(() => parseTerraformLock({ ...fixture().head, lease }, path)).toThrow()
})

it("binds recovery to exactly the selected container and key, not an account-prefixed or foreign path", () => {
  const { info, head } = fixture()
  for (const Path of [
    "synthetic-account/terraform/sample-hub/app.tfstate",
    "terraform/another-hub/app.tfstate",
    "terraform/sample-hub/foundation.tfstate",
    "Terraform/sample-hub/app.tfstate",
  ])
    expect(() => parseTerraformLock({
      ...head,
      lock: Buffer.from(JSON.stringify({ ...info, Path })).toString("base64"),
    }, path)).toThrow(/another state path/i)
})

it("fingerprints both the lock metadata and current blob identity so unchanged IDs cannot hide a new writer", () => {
  const { info, head } = fixture()
  const expected = parseTerraformLock(head, path)!
  for (const change of [
    { lock: Buffer.from(JSON.stringify({ ...info, Who: "another-synthetic-writer" })).toString("base64") },
    { etag: '"another-synthetic-etag"' },
    { modified: "2026-11-10T18:00:01.000Z" },
    { size: 129 },
  ]) {
    const snapshot = parseTerraformLock({ ...head, ...change }, path)!
    expect(snapshot.id).toBe(expected.id)
    expect(snapshot.fingerprint).not.toBe(expected.fingerprint)
  }
})

it("rejects noncanonical, oversized, malformed and nonobject encoded lock metadata without disclosing it", () => {
  const { head } = fixture()
  for (const lock of [
    undefined,
    `${head.lock}\n`,
    head.lock.replace(/=+$/, ""),
    "A".repeat(16_388),
    Buffer.from("synthetic-private-non-json").toString("base64"),
    Buffer.from("[]").toString("base64"),
  ]) {
    expect(lock).not.toBe(head.lock)
    expect(() => parseTerraformLock({ ...head, lock }, path)).toThrow(/metadata/i)
    try { parseTerraformLock({ ...head, lock }, path) }
    catch (error) {
      expect(String(error)).not.toContain("synthetic-private-non-json")
      if (typeof lock === "string" && lock.length > 10) expect(String(error)).not.toContain(lock)
    }
  }
})

it.each([
  ["ID", "synthetic-private-id"],
  ["Who", ""],
  ["Who", "synthetic-private-owner\ninjected"],
  ["Who", "x".repeat(257)],
  ["Operation", "synthetic-private-operation"],
  ["Version", "2.0.0"],
  ["Version", "1.013.4"],
  ["Created", "yesterday"],
  ["Created", "2026-11-10"],
  ["Created", "2026-02-30T00:00:00Z"],
] as const)("rejects an unverifiable %s in LockInfo without exposing private fields (%s)", (key, value) => {
  const { info, head } = fixture()
  const lock = Buffer.from(JSON.stringify({ ...info, [key]: value })).toString("base64")
  expect(() => parseTerraformLock({ ...head, lock }, path)).toThrow()
  try { parseTerraformLock({ ...head, lock }, path) }
  catch (error) {
    for (const privateValue of [info.ID, info.Who, lock, "synthetic-private"])
      expect(String(error)).not.toContain(privateValue)
  }
})

it.each([
  { etag: "" },
  { etag: "synthetic-private-etag\ninjected" },
  { modified: "invalid" },
  { modified: "March 1, 2026" },
  { size: 0 },
  { size: 1.5 },
  { size: Number.MAX_SAFE_INTEGER + 1 },
])("requires verifiable nonempty existing state blob evidence: %j", (change) => {
  expect(() => parseTerraformLock({ ...fixture().head, ...change }, path)).toThrow(/blob/i)
})

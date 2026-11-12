import { expect, it } from "vitest"

import { RemovalLeaseError } from "./index.ts"

const target = {
  installation: "sample-hub",
  subscription: "00000000-0000-0000-0000-000000000001",
  kind: "installation" as const,
  account: "samplestate",
  container: "terraform",
  blob: "sample-hub/installer.lock",
}

it.each([
  { kind: "installation" as const, label: "Installation lock", retained: true },
  { kind: "release" as const, label: "Release lock", retained: true },
  { kind: "terraform" as const, label: "Terraform state lock", retained: false },
])("identifies exact $kind lease coordinates without classifying a state lock as operational", ({
  kind, label, retained,
}) => {
  const coordinates = { ...target, kind }
  const error = new RemovalLeaseError(coordinates, {
    status: "locked", state: "leased", duration: "infinite",
    leaseId: "synthetic-private-lease-id",
  })

  expect(error).toBeInstanceOf(Error)
  expect(error.name).toBe("RemovalLeaseError")
  expect(error.target).toEqual(coordinates)
  expect(error.knownRetained).toBe(retained)
  expect(error.message).toContain(label)
  expect(error.message).toContain(target.installation)
  expect(error.message).toContain(target.subscription)
  expect(error.message).toContain(`${target.account}/${target.container}/${target.blob}`)
  expect(error.message).toContain("status=locked, state=leased, duration=infinite")
  expect(error.message).not.toContain("synthetic-private-lease-id")
  if (kind === "terraform") expect(error.message).toMatch(/valid lock metadata.*stable safety evidence/i)
})

it.each([
  null,
  "synthetic-private-response",
  { status: "synthetic-private-status", state: "synthetic-private-state", duration: "synthetic-private-duration" },
  { status: ["locked"], state: ["leased"], duration: ["infinite"] },
  { status: "locked", state: "leased", duration: "fixed" },
  { status: "locked", state: "breaking", duration: "infinite" },
])("never offers unknown, malformed, finite, or changing lease metadata as retained: %j", (lease) => {
  const error = new RemovalLeaseError(target, lease)

  expect(error.knownRetained).toBe(false)
  expect(error.message).not.toContain("synthetic-private")
  if (lease === null || typeof lease !== "object" || Array.isArray(lease.status))
    expect(error.message).toContain("status=unknown")
})

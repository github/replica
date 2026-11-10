import { expect, it } from "vitest"

import { guidedPostgresProfile } from "../profile.ts"
import { supportsPostgresProfile } from "./index.ts"

function catalogue() {
  return {
    status: null as string | null,
    reason: null,
    restricted: null as boolean | null,
    supportedServerVersions: [{ name: "17", status: null as string | null, reason: null }],
    supportedServerEditions: [{
      name: "Burstable",
      status: null as string | null,
      reason: null,
      defaultSkuName: "Standard_B1ms",
      supportedStorageEditions: [],
      supportedServerSkus: [{ name: "Standard_B1ms", status: null as string | null, reason: null }],
    }],
  }
}

it("accepts advertised membership in the operator's null-status catalogue for each Terraform tier", () => {
  for (const [prefix, edition, sku] of [
    ["B", "Burstable", "Standard_B1ms"],
    ["GP", "GeneralPurpose", "Standard_D2s_v3"],
    ["MO", "MemoryOptimized", "Standard_E2s_v3"],
  ]) {
    const data = catalogue()
    data.supportedServerEditions[0]!.name = edition!
    data.supportedServerEditions[0]!.supportedServerSkus[0]!.name = sku!

    expect(supportsPostgresProfile([data], {
      postgres_sku: `${prefix}_${sku}`,
      postgres_version: "17",
    })).toBe(true)
  }
})

it("requires the exact SKU, matching edition, and root major version rather than defaults or near matches", () => {
  for (const change of ["SKU case", "SKU suffix", "edition", "version", "missing SKU"]) {
    const data = catalogue()
    const edition = data.supportedServerEditions[0]!
    if (change === "SKU case") edition.supportedServerSkus[0]!.name = "standard_b1ms"
    if (change === "SKU suffix") edition.supportedServerSkus[0]!.name = "Standard_B1ms_extra"
    if (change === "edition") edition.name = "GeneralPurpose"
    if (change === "version") data.supportedServerVersions[0]!.name = "170"
    if (change === "missing SKU") edition.supportedServerSkus = []

    expect(supportsPostgresProfile([data], guidedPostgresProfile), change).toBe(false)
  }
})

it("does not combine an advertised SKU and version from different catalogues", () => {
  const skuOnly = catalogue()
  skuOnly.supportedServerVersions[0]!.name = "16"
  const versionOnly = catalogue()
  versionOnly.supportedServerEditions[0]!.supportedServerSkus[0]!.name = "Standard_B2s"

  expect(supportsPostgresProfile([skuOnly, versionOnly], guidedPostgresProfile)).toBe(false)
})

it("returns unsupported for empty valid catalogue lists and supported-member arrays", () => {
  const noVersions = catalogue()
  noVersions.supportedServerVersions = []
  const noEditions = catalogue()
  noEditions.supportedServerEditions = []

  for (const value of [[], [noVersions], [noEditions]])
    expect(supportsPostgresProfile(value, guidedPostgresProfile)).toBe(false)
})

it("does not count explicit unavailability or restriction at any advertised level", () => {
  for (const level of ["catalogue", "restriction", "edition", "SKU", "version"]) {
    const data = catalogue()
    if (level === "catalogue") data.status = "Unavailable"
    if (level === "restriction") data.restricted = true
    if (level === "edition") data.supportedServerEditions[0]!.status = "Disabled"
    if (level === "SKU") data.supportedServerEditions[0]!.supportedServerSkus[0]!.status = "Restricted"
    if (level === "version") data.supportedServerVersions[0]!.status = "NotSupported"

    expect(supportsPostgresProfile([data], guidedPostgresProfile), level).toBe(false)
  }
})

it("recognizes explicitly unavailable catalogue or edition records without optional supported arrays", () => {
  for (const value of [
    [{ status: "Unavailable", reason: "Synthetic policy restriction" }],
    [{ restricted: true, status: null, reason: "Synthetic policy restriction" }],
    [{
      ...catalogue(),
      supportedServerEditions: [{ name: "Burstable", status: "Disabled", reason: null }],
    }],
  ])
    expect(supportsPostgresProfile(value, guidedPostgresProfile)).toBe(false)
})

it("validates the whole response before accepting an earlier compatible catalogue", () => {
  for (const malformed of [
    {},
    { ...catalogue(), supportedServerVersions: undefined },
    { ...catalogue(), supportedServerVersions: ["17"] },
    { ...catalogue(), supportedServerEditions: [{ name: "Burstable", status: null }] },
    { ...catalogue(), supportedServerVersions: [{ name: "17", status: "synthetic-unknown-status" }] },
    { ...catalogue(), restricted: "synthetic-unknown-restriction" },
  ]) {
    expect(() => supportsPostgresProfile([catalogue(), malformed], guidedPostgresProfile))
      .toThrow(/invalid|unrecognized/i)
  }
  for (const value of [null, {}, { value: [catalogue()] }])
    expect(() => supportsPostgresProfile(value, guidedPostgresProfile)).toThrow()
})

it("does not disclose unknown status values or raw catalogue content in schema errors", () => {
  const data = catalogue()
  data.supportedServerEditions[0]!.supportedServerSkus[0]!.status = "synthetic-private-status"
  let failure: unknown
  try {
    supportsPostgresProfile([data], guidedPostgresProfile)
  } catch (error) {
    failure = error
  }

  expect(failure).toBeInstanceOf(Error)
  expect(String(failure)).toMatch(/invalid|unrecognized/i)
  expect(String(failure)).not.toContain("synthetic-private-status")
  expect(String(failure)).not.toContain("supportedServerEditions")
})

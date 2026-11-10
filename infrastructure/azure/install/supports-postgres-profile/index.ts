import type { PostgresProfile } from "../profile.ts"

export function supportsPostgresProfile(value: unknown, profile: PostgresProfile): boolean {
  function invalid(): never {
    throw new Error(
      "Azure PostgreSQL capability data is unrecognized or invalid. Compatibility could not be verified; no deployment was authorized.",
    )
  }
  function object(value: unknown): Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) invalid()
    return value as Record<string, unknown>
  }
  function entries(value: unknown): Record<string, unknown>[] {
    if (!Array.isArray(value)) invalid()
    return value.map(object)
  }
  function available(value: Record<string, unknown>): boolean {
    const status = value.status
    if (status === undefined || status === null) return true
    if (typeof status !== "string") invalid()
    if (["available", "enabled", "supported"].includes(status.toLowerCase())) return true
    if (
      [
        "unavailable",
        "disabled",
        "unsupported",
        "restricted",
        "notavailable",
        "notsupported",
      ].includes(status.toLowerCase())
    )
      return false
    return invalid()
  }
  function name(value: Record<string, unknown>): string {
    if (typeof value.name !== "string" || !value.name) invalid()
    return value.name
  }
  const [tier, ...parts] = profile.postgres_sku.split("_")
  const editions: Readonly<Record<string, string>> = {
    B: "Burstable",
    GP: "GeneralPurpose",
    MO: "MemoryOptimized",
  }
  const edition = tier ? editions[tier] : undefined
  if (
    !edition ||
    !/^Standard_[A-Za-z0-9_]+$/.test(parts.join("_")) ||
    !/^\d+$/.test(profile.postgres_version)
  )
    invalid()
  const catalogues = entries(value).map((catalogue) => {
    const restricted = catalogue.restricted
    if (
      restricted !== undefined &&
      restricted !== null &&
      typeof restricted !== "boolean" &&
      !["true", "false"].includes(String(restricted).toLowerCase())
    )
      invalid()
    const enabled =
      available(catalogue) && restricted !== true && String(restricted).toLowerCase() !== "true"
    if (!enabled) return { available: false, versions: [], editions: [] }
    return {
      available: true,
      versions: entries(catalogue.supportedServerVersions).map((version) => ({
        name: name(version),
        available: available(version),
      })),
      editions: entries(catalogue.supportedServerEditions).map((entry) => {
        const enabled = available(entry)
        return {
          name: name(entry),
          available: enabled,
          skus: enabled
            ? entries(entry.supportedServerSkus).map((sku) => ({
                name: name(sku),
                available: available(sku),
              }))
            : [],
        }
      }),
    }
  })
  return catalogues.some(
    (catalogue) =>
      catalogue.available &&
      catalogue.versions.some(
        (version) => version.available && version.name === profile.postgres_version,
      ) &&
      catalogue.editions.some(
        (entry) =>
          entry.available &&
          entry.name === edition &&
          entry.skus.some((sku) => sku.available && sku.name === parts.join("_")),
      ),
  )
}

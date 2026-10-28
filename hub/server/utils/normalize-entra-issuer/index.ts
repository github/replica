const entraIssuerPattern =
  /^https:\/\/login\.microsoftonline\.com\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/v2\.0\/?$/i

export function normalizeEntraIssuer(value: string): string | null {
  const match = value.match(entraIssuerPattern)
  const tenantId = match?.[1]
  return tenantId ? `https://login.microsoftonline.com/${tenantId.toLowerCase()}/v2.0` : null
}

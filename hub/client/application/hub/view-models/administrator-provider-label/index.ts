export function administratorProviderLabel(provider: string | null) {
  if (!provider) return "Provider profile unavailable"
  if (provider === "github") return "GitHub account"
  if (provider === "entra") return "Microsoft Entra account"
  return `${provider} account`
}

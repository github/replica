export function administratorProviderLabel(provider: string) {
  if (provider === "github") return "GitHub account"
  if (provider === "entra") return "Microsoft Entra account"
  return `${provider} account`
}

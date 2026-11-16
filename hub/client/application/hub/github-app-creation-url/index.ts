import { githubAppRequirements } from "@utils/github-app-requirements"

/** Builds GitHub's prefilled App-creation URL; GitHub never receives secrets from Hub. */
export function githubAppCreationUrl(
  urls: { homepage: string; callback: string; setup: string; webhook: string },
  organization: string,
) {
  const owner = organization.trim()
  const base = owner
    ? `https://github.com/organizations/${encodeURIComponent(owner)}/settings/apps/new`
    : "https://github.com/settings/apps/new"
  const url = new URL(base)
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(new URL(urls.homepage).hostname)
  url.searchParams.set("name", owner ? `Replica Hub (${owner})` : "Replica Hub")
  url.searchParams.set("description", "Build and review prototype branches.")
  url.searchParams.set("url", urls.homepage)
  url.searchParams.append("callback_urls[]", urls.callback)
  url.searchParams.set("request_oauth_on_install", "false")
  url.searchParams.set("setup_url", urls.setup)
  url.searchParams.set("setup_on_update", "false")
  url.searchParams.set("public", "false")
  url.searchParams.set("webhook_active", String(!local))
  url.searchParams.set("webhook_url", urls.webhook)
  for (const permission of [
    ...githubAppRequirements.permissions,
    ...githubAppRequirements.organizationPermissions,
  ]) {
    url.searchParams.set(permission.key, permission.access)
  }
  for (const event of githubAppRequirements.events) url.searchParams.append("events[]", event.key)
  return url.href
}

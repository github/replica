import type { IdentitySettings } from "#server/utils/identity-contracts/types"

export function getIdentityCookies(settings: Pick<IdentitySettings, "secureCookies">) {
  const prefix = settings.secureCookies ? "__Host-" : ""
  return {
    sessionName: `${prefix}replica-session`,
    oauthName: `${prefix}replica-oauth`,
    options: {
      httpOnly: true,
      secure: settings.secureCookies,
      sameSite: "lax",
      path: "/",
    } as const,
  }
}

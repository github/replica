import { describe, expect, it } from "vitest"

import { readAuthenticationProvider } from "#server/domains/authentication/read-authentication-provider"

describe("readAuthenticationProvider()", () => {
  it.each(["github", "oidc"] as const)(
    "returns the explicitly configured %s provider",
    (provider) => {
      expect(readAuthenticationProvider({ HUB_AUTH_PROVIDER: provider })).toBe(provider)
    },
  )

  it.each([undefined, "", "GitHub", "oidc ", "other"])(
    "rejects a missing or unsupported provider value %s",
    (provider) => {
      expect(() => readAuthenticationProvider({ HUB_AUTH_PROVIDER: provider })).toThrow(
        "Set HUB_AUTH_PROVIDER to github or oidc.",
      )
    },
  )
})

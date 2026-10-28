import { describe, expect, it } from "vitest"

import { ensureProviderAdmissionPolicy } from "#server/domains/authentication/ensure-provider-admission-policy"

describe("ensureProviderAdmissionPolicy()", () => {
  it.each(["github-synchronized", "legacy-repository"])(
    "rejects OIDC with the non-Hub-managed %s admission policy",
    (policy) => {
      expect(() => ensureProviderAdmissionPolicy("oidc", { HUB_ADMISSION_POLICY: policy })).toThrow(
        "OIDC authentication requires HUB_ADMISSION_POLICY=hub-managed.",
      )
    },
  )

  it("allows Hub-managed OIDC and preserves GitHub admission policy choices", () => {
    expect(() => ensureProviderAdmissionPolicy("oidc", {})).not.toThrow()
    expect(() =>
      ensureProviderAdmissionPolicy("github", {
        HUB_ADMISSION_POLICY: "github-synchronized",
      }),
    ).not.toThrow()
  })
})

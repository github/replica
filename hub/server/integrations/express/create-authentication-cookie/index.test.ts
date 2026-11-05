import { describe, expect, it } from "vitest"

import { clearAuthenticationCookie } from "../clear-authentication-cookie"
import { createAuthenticationCookie } from "."

describe("createAuthenticationCookie()", () => {
  it("sets the bounded browser-session attributes and Secure when required", () => {
    const cookie = createAuthenticationCookie({
      expiresAt: new Date("2030-01-01T00:00:00Z"),
      name: "hub_session",
      secure: true,
      value: "opaque value",
    })

    expect(cookie).toBe(
      "hub_session=opaque%20value; Path=/; HttpOnly; SameSite=Lax; Secure; Expires=Tue, 01 Jan 2030 00:00:00 GMT",
    )
  })

  it("omits Secure only for loopback development and clears the same scope", () => {
    expect(
      createAuthenticationCookie({
        expiresAt: new Date("2030-01-01T00:00:00Z"),
        name: "hub_session",
        secure: false,
        value: "opaque",
      }),
    ).not.toContain("Secure")
    expect(clearAuthenticationCookie("hub_session", true)).toBe(
      "hub_session=; Path=/; HttpOnly; SameSite=Lax; Secure; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0",
    )
  })
})

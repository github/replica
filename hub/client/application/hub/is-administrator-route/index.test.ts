import { describe, expect, it } from "vitest"

import { isAdministratorRoute } from "."

describe("isAdministratorRoute()", () => {
  it.each([
    "/settings/administrators",
    "/settings/administrators/11111111-1111-4111-8111-111111111111",
    "/settings/admins",
    "/settings/admins/11111111-1111-4111-8111-111111111111",
    "/settings/audit",
    "/settings/audit/",
    "/Settings/Audit",
  ])("classifies %s as an administrator route", (pathname) => {
    expect(isAdministratorRoute(new Request(`https://hub.example.test${pathname}`))).toBe(true)
  })

  it("does not classify ordinary settings routes as administrator routes", () => {
    expect(isAdministratorRoute(new Request("https://hub.example.test/settings/sharing"))).toBe(
      false,
    )
  })
})

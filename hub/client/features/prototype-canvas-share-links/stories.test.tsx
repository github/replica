import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { HubThemeProvider } from "@hooks/use-hub-theme"

import { ShareLinksPage } from "."
import { shareCopy } from "@hooks/use-canvas-share-links/en"
import meta, { ControlSettings, ManyLinks, Multiple, Single, TwoBuilds } from "./stories"

describe("ShareLinksPage stories", () => {
  it.each([
    ["Single", Single],
    ["ManyLinks", ManyLinks],
    ["ControlSettings", ControlSettings],
    ["Multiple", Multiple],
    ["TwoBuilds", TwoBuilds],
  ] as const)("keeps %s links active for seven days with usable actions", (_name, story) => {
    const links = story.args?.state?.links
    if (!links?.length) throw new Error("The active-link story must contain links.")

    const now = Date.now()
    for (const link of links) {
      if (!link.createdAt || !link.expiresAt) {
        throw new Error("The active-link fixture must have creation and expiry timestamps.")
      }
      const createdAt = Date.parse(link.createdAt)
      const expiresAt = Date.parse(link.expiresAt)
      expect(createdAt).toBeLessThanOrEqual(now)
      expect(expiresAt).toBeGreaterThan(now)
      expect(expiresAt - createdAt).toBe(7 * 24 * 60 * 60 * 1000)
    }

    render(<ShareLinksPage {...meta.args} {...story.args} />, { wrapper: HubThemeProvider })

    const link = links[0]!
    expect(
      screen.getByRole("button", { name: shareCopy.copy(link.label, link.buildNumber) }),
    ).toBeEnabled()
    expect(
      screen.getByRole("button", { name: shareCopy.open(link.label, link.buildNumber) }),
    ).toBeEnabled()
    expect(
      screen.getByRole("button", { name: shareCopy.delete(link.label, link.buildNumber) }),
    ).toBeEnabled()
    expect(screen.queryByText(shareCopy.expired)).not.toBeInTheDocument()
  })
})

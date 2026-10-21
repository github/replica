import { NavigationContext } from "@thoughtbot/superglue"
import { createEvent, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { HubThemeProvider } from "@hooks/use-hub-theme"

import { PrototypeWorkspaceHeader } from "."
import story from "./stories"

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})
afterEach(() => vi.unstubAllGlobals())

describe("PrototypeWorkspaceHeader()", () => {
  it("keeps author identity in the normal prototype header", () => {
    render(
      <HubThemeProvider>
        <PrototypeWorkspaceHeader {...story.args} />
      </HubThemeProvider>,
    )
    expect(screen.getByRole("link", { name: "By @octocat" })).toHaveAttribute(
      "href",
      "https://github.com/octocat",
    )
  })

  it("uses Superglue navigation once when Space activates a focused Build option", () => {
    const visit = vi.fn()
    const path = "/repositories/2001/prototypes/1?build=2"
    render(
      <HubThemeProvider>
        <NavigationContext.Provider
          value={{ pageKey: "/", search: {}, navigateTo: vi.fn(), remote: vi.fn(), visit }}
        >
          <PrototypeWorkspaceHeader
            {...story.args}
            data={{
              ...story.args.data,
              buildOptions: [
                ...story.args.data.buildOptions,
                { number: 2, label: "v2", path, state: "successful" },
              ],
            }}
          />
        </NavigationContext.Provider>
      </HubThemeProvider>,
    )

    fireEvent.click(screen.getByRole("button", { name: "Choose build, v1" }))
    const option = screen.getByRole("menuitem", { name: "v2" })
    option.focus()
    expect(option).toHaveFocus()

    const space = createEvent.keyDown(option, { key: " ", code: "Space" })
    fireEvent(option, space)

    expect(space.defaultPrevented).toBe(true)
    expect(visit).toHaveBeenCalledExactlyOnceWith(path, {
      method: "GET",
      dataset: { sgVisit: "true" },
    })
  })
})

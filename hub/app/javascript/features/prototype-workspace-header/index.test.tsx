import { createEvent, fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

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

  it("activates the native Build link once when Space is pressed", () => {
    const path = "/repositories/2001/prototypes/1?build=2"
    render(
      <HubThemeProvider>
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
      </HubThemeProvider>,
    )

    fireEvent.click(screen.getByRole("button", { name: "Choose build, v1" }))
    const option = screen.getByRole("menuitem", { name: "v2" })
    const link = option.querySelector("a")!
    const click = vi.fn((event: MouseEvent) => event.preventDefault())
    link.addEventListener("click", click)
    option.focus()
    expect(option).toHaveFocus()

    const space = createEvent.keyDown(option, { key: " ", code: "Space" })
    fireEvent(option, space)

    expect(space.defaultPrevented).toBe(true)
    expect(link).toHaveAttribute("href", path)
    expect(click).toHaveBeenCalledOnce()
  })
})

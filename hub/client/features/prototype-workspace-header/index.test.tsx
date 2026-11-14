import { createEvent, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
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

  it("does not announce an unavailable latest Build as the current page", () => {
    render(
      <HubThemeProvider>
        <PrototypeWorkspaceHeader
          {...story.args}
          data={{
            ...story.args.data,
            selectedBuild: undefined,
            selectedBuildNumber: undefined,
            latestBuild: { number: 2, state: "running", stateLabel: "Running" },
            buildOptions: [
              { number: 2, label: "v2", path: null, state: "running", stateLabel: "Running" },
              { number: 1, label: "v1", path: null, state: "failed", stateLabel: "Failed" },
            ],
          }}
        />
      </HubThemeProvider>,
    )

    fireEvent.click(screen.getByRole("button", { name: /Choose build/ }))
    const menu = screen.getByRole("menu", { name: "Choose build" })
    const running = within(menu).getByRole("menuitem", { name: /v2.*Running/ })
    const failed = within(menu).getByRole("menuitem", { name: /v1.*Failed/ })

    expect(running).toHaveAttribute("aria-disabled", "true")
    expect(failed).toHaveAttribute("aria-disabled", "true")
    expect(running).not.toHaveAttribute("aria-current")
    expect(failed).not.toHaveAttribute("aria-current")
  })

  it("announces the selected successful Build as the current page", () => {
    render(
      <HubThemeProvider>
        <PrototypeWorkspaceHeader {...story.args} />
      </HubThemeProvider>,
    )

    fireEvent.click(screen.getByRole("button", { name: "Choose build, v1" }))
    expect(screen.getByRole("menuitem", { name: /v1.*Successful/ })).toHaveAttribute(
      "aria-current",
      "page",
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

  it("dismisses Build choices for an ordinary link while preserving modified clicks and bubbling", async () => {
    const path = "/repositories/2001/prototypes/1?build=2"
    const delegatedClick = vi.fn<(prevented: boolean) => void>()
    render(
      <div
        onClick={(event) => {
          if (event.target instanceof Element && event.target.closest("a")) {
            delegatedClick(event.defaultPrevented)
            event.preventDefault()
          }
        }}
      >
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
        </HubThemeProvider>
      </div>,
    )
    const trigger = screen.getByRole("button", { name: "Choose build, v1" })
    fireEvent.click(trigger)
    const link = screen.getByRole("menuitem", { name: "v2" }).querySelector("a")
    if (!link) throw new Error("The Build option has no native link.")
    expect(link).toHaveAttribute("href", path)

    fireEvent.click(link, { ctrlKey: true })
    expect(delegatedClick).toHaveBeenCalledExactlyOnceWith(false)
    expect(trigger).toHaveAttribute("aria-expanded", "true")
    fireEvent.click(link)

    expect(delegatedClick).toHaveBeenCalledTimes(2)
    expect(delegatedClick).toHaveBeenLastCalledWith(false)
    await waitFor(() => {
      expect(trigger).toHaveAttribute("aria-expanded", "false")
      expect(trigger).toHaveFocus()
    })
    expect(screen.queryByRole("menu", { name: "Choose build" })).not.toBeInTheDocument()
  })
})

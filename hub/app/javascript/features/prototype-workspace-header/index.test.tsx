import { NavigationContext } from "@thoughtbot/superglue"
import { createEvent, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
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
  it("copies any successful Build without selecting it or navigating", async () => {
    localStorage.removeItem("replica:share-full-screen-preview:v1")
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal("navigator", { clipboard: { writeText } })
    const visit = vi.fn()
    const data = {
      ...story.args.data,
      buildOptions: [
        {
          number: 4,
          label: "v4",
          path: "/repositories/2001/prototypes/1?build=4",
          state: "running" as const,
        },
        {
          number: 3,
          label: "v3",
          path: "/repositories/2001/prototypes/1?build=3",
          state: "failed" as const,
        },
        {
          number: 2,
          label: "v2",
          path: "/repositories/2001/prototypes/1?build=2",
          state: "successful" as const,
        },
        {
          number: 1,
          label: "v1",
          path: "/repositories/2001/prototypes/1?build=1",
          state: "successful" as const,
        },
      ],
      selectedBuild: { ...story.args.data.selectedBuild!, number: 1 },
    }
    render(
      <HubThemeProvider>
        <NavigationContext.Provider
          value={{ pageKey: "/", search: {}, navigateTo: vi.fn(), remote: vi.fn(), visit }}
        >
          <PrototypeWorkspaceHeader {...story.args} data={data} />
        </NavigationContext.Provider>
      </HubThemeProvider>,
    )

    for (const number of [2, 1]) {
      const trigger = screen.getByRole("button", { name: "Choose build, v1" })
      if (trigger.getAttribute("aria-expanded") !== "true") fireEvent.click(trigger)
      expect(screen.queryByRole("menuitem", { name: "Copy build link" })).not.toBeInTheDocument()
      expect(
        screen.queryByRole("menuitem", { name: "Copy link to Build 3" }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole("menuitem", { name: "Copy link to Build 4" }),
      ).not.toBeInTheDocument()
      expect(screen.getByRole("menuitem", { name: "v3" })).toBeInTheDocument()
      expect(screen.getByRole("menuitem", { name: "v4" })).toBeInTheDocument()
      const copy = screen.getByRole("menuitem", { name: `Copy link to Build ${number}` })
      expect(copy).toHaveTextContent("")
      expect(copy.closest("a")).toBeNull()
      fireEvent.click(copy)
      await waitFor(() =>
        expect(writeText).toHaveBeenLastCalledWith(
          new URL(
            `/repositories/2001/prototypes/1?build=${number}&view=minimized`,
            window.location.href,
          ).toString(),
        ),
      )
      expect(await screen.findByText(`Link to Build ${number} copied`)).toBeInTheDocument()
    }
    expect(visit).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "Choose build, v1" })).toBeInTheDocument()
  })

  it.each(["Enter", " "])("activates a copy menu item with %j without navigating", async (key) => {
    localStorage.removeItem("replica:share-full-screen-preview:v1")
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal("navigator", { clipboard: { writeText } })
    const visit = vi.fn()
    render(
      <HubThemeProvider>
        <NavigationContext.Provider
          value={{ pageKey: "/", search: {}, navigateTo: vi.fn(), remote: vi.fn(), visit }}
        >
          <PrototypeWorkspaceHeader {...story.args} />
        </NavigationContext.Provider>
      </HubThemeProvider>,
    )
    fireEvent.click(screen.getByRole("button", { name: "Choose build, v1" }))
    const option = screen.getByRole("menuitem", { name: "v1" })
    option.focus()
    fireEvent.keyDown(option, { key: "ArrowDown" })
    const copy = screen.getByRole("menuitem", { name: "Copy link to Build 1" })
    if (document.activeElement !== copy) {
      expect(option).toContainElement(document.activeElement as HTMLElement)
      fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" })
    }
    await waitFor(() => expect(copy).toHaveFocus())

    fireEvent.keyDown(copy, { key })

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledExactlyOnceWith(
        new URL(
          "/repositories/2001/prototypes/1?build=1&view=minimized",
          window.location.href,
        ).toString(),
      ),
    )
    expect(visit).not.toHaveBeenCalled()
  })

  it("uses the saved fullscreen preference when copying a Build from the menu", async () => {
    localStorage.setItem("replica:share-full-screen-preview:v1", "false")
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal("navigator", { clipboard: { writeText } })
    render(
      <HubThemeProvider>
        <PrototypeWorkspaceHeader {...story.args} />
      </HubThemeProvider>,
    )
    fireEvent.click(screen.getByRole("button", { name: "Choose build, v1" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy link to Build 1" }))

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledExactlyOnceWith(
        new URL("/repositories/2001/prototypes/1?build=1", window.location.href).toString(),
      ),
    )
  })

  it("keeps a numbered fallback when copying a non-selected Build fails", async () => {
    localStorage.removeItem("replica:share-full-screen-preview:v1")
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("Clipboard unavailable")) },
    })
    const visit = vi.fn()
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
                {
                  number: 2,
                  label: "v2",
                  path: "/repositories/2001/prototypes/1?build=2",
                  state: "successful",
                },
              ],
            }}
          />
        </NavigationContext.Provider>
      </HubThemeProvider>,
    )
    fireEvent.click(screen.getByRole("button", { name: "Choose build, v1" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy link to Build 2" }))

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent(/could not copy/i)
    expect(within(alert).getByRole("link")).toHaveAttribute(
      "href",
      new URL(
        "/repositories/2001/prototypes/1?build=2&view=minimized",
        window.location.href,
      ).toString(),
    )
    expect(visit).not.toHaveBeenCalled()
  })

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

  it("preserves current option settings when opening History", () => {
    const original = window.location.href
    try {
      window.history.replaceState({}, "", "/preview?rc.page.title=%22Shared%22")
      const visit = vi.fn()
      render(
        <HubThemeProvider>
          <NavigationContext.Provider
            value={{ pageKey: "/", search: {}, navigateTo: vi.fn(), remote: vi.fn(), visit }}
          >
            <PrototypeWorkspaceHeader {...story.args} />
          </NavigationContext.Provider>
        </HubThemeProvider>,
      )
      fireEvent.click(screen.getByRole("button", { name: "More actions" }))
      fireEvent.click(screen.getByRole("menuitem", { name: "History" }))
      expect(visit).toHaveBeenCalledExactlyOnceWith(
        "/repositories/2001/prototypes/1/builds?rc.page.title=%22Shared%22",
        { method: "GET", dataset: { sgVisit: "true" } },
      )
    } finally {
      window.history.replaceState({}, "", original)
    }
  })

  it("includes each available Build status in the option's accessible name", () => {
    render(
      <HubThemeProvider>
        <PrototypeWorkspaceHeader
          {...story.args}
          data={{
            ...story.args.data,
            buildOptions: [
              { number: 1, label: "v1", path: "?build=1", state: "queued", stateLabel: "Queued" },
              { number: 2, label: "v2", path: "?build=2", state: "running", stateLabel: "Running" },
              { number: 3, label: "v3", path: "?build=3", state: "failed", stateLabel: "Failed" },
              {
                number: 4,
                label: "v4",
                path: "?build=4",
                state: "successful",
                stateLabel: "Ready to review",
              },
              {
                number: 5,
                label: "v5",
                path: "?build=5",
                state: "superseded",
                stateLabel: "Superseded",
              },
              { number: 6, label: "v6", path: "?build=6", state: "successful" },
            ],
          }}
        />
      </HubThemeProvider>,
    )

    fireEvent.click(screen.getByRole("button", { name: "Choose build, v1" }))
    for (const name of [
      "v1 Queued",
      "v2 Running",
      "v3 Failed",
      "v4 Ready to review",
      "v5 Superseded",
      "v6",
    ]) {
      expect(screen.getByRole("menuitem", { name })).toBeInTheDocument()
    }
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

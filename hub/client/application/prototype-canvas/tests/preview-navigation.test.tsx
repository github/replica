import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { publicationHub, publicationState } from "@utils/resolve-prototype-publication/fixtures"
import { isHubStatusRequest } from "./is-hub-status-request"
import { App } from ".."

describe("App()", () => {
  it.each([
    [
      "http://localhost:4321/",
      "/settings?q=a%20b#details",
      "http://localhost:4321/settings?q=a%20b#details",
    ],
    [
      "http://localhost:4321/explicit?q=1#comment",
      "/settings",
      "http://localhost:4321/explicit?q=1#comment",
    ],
    ["http://localhost:4321/#/explicit", "/settings", "http://localhost:4321/#/explicit"],
    ["http://localhost:4321/?tab=explicit", "/settings", "http://localhost:4321/?tab=explicit"],
    ["http://localhost:4321/", null, "http://localhost:4321/"],
  ])(
    "opens %s at its initial destination without navigating on later metadata updates",
    async (prototypeUrl, initialStartPage, expected) => {
      let startPage = initialStartPage
      let statusReads = 0
      vi.stubGlobal(
        "fetch",
        vi.fn((input: RequestInfo | URL) => {
          const path =
            typeof input === "string" ? input : input instanceof URL ? input.href : input.url
          if (path === "/api/hub/events") throw new Error("No live connection")
          if (isHubStatusRequest(path)) statusReads += 1
          const data = isHubStatusRequest(path)
            ? {
                state: "connected",
                repository: "github/prototype",
                branch: "prototype/welcome",
                prototype: {
                  id: 1,
                  repositoryId: 2001,
                  branch: "prototype/welcome",
                  name: "Welcome",
                  description: null,
                  startPage,
                  viewerLogin: "octocat",
                  registered: true,
                  canEdit: true,
                  canRegister: true,
                  published: false,
                  build: null,
                  buildState: null,
                  versionCount: 0,
                },
              }
            : path === "/api/hub/comments"
              ? { comments: [], hasMore: false, nextCursor: null }
              : {
                  name: "Welcome",
                  stats: { repository: "github/prototype", branch: "prototype/welcome" },
                }
          return Promise.resolve(
            new Response(JSON.stringify(data), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          )
        }),
      )
      const view = render(<App config={{ name: "Welcome", prototypeUrl, token: "local" }} />)
      await waitFor(() => expect(statusReads).toBe(1))
      await waitFor(() =>
        expect(screen.getByTitle("Welcome prototype")).toHaveAttribute("src", expected),
      )

      startPage = "/changed"
      fireEvent.focus(window)
      await waitFor(() => expect(statusReads).toBe(2))
      expect(screen.getByTitle("Welcome prototype")).toHaveAttribute("src", expected)
      view.unmount()
    },
  )
  it("tracks preview routes in the browser bar and navigates back and forward", async () => {
    const nonce = "00000000-0000-4000-8000-000000000003"
    vi.spyOn(crypto, "randomUUID").mockReturnValue(nonce)
    vi.stubGlobal(
      "fetch",
      vi.fn((path: string) =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              isHubStatusRequest(path)
                ? { state: "unconfigured" }
                : path === "/api/hub/comments"
                  ? { comments: [], hasMore: false, nextCursor: null }
                  : publicationState,
            ),
          ),
        ),
      ),
    )
    const view = render(
      <App config={{ name: "Demo", prototypeUrl: "http://localhost:4321/", token: "local" }} />,
    )
    const frame = screen.getByTitle("Demo prototype")
    if (!(frame instanceof HTMLIFrameElement)) throw new Error("Expected a preview frame.")
    const address = screen.getByRole("textbox", { name: "Prototype address" })
    await waitFor(() => expect(frame.contentWindow).toBeTruthy())

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "http://localhost:4321",
          source: frame.contentWindow,
          data: {
            type: "replica:canvas:ready",
            nonce,
            protocolVersion: 1,
            route: { pathname: "/settings", search: "?tab=account", hash: "#profile" },
          },
        }),
      )
    })
    expect(address).toHaveValue("http://localhost:4321/settings?tab=account#profile")
    expect(screen.getByRole("button", { name: "Back" })).toBeEnabled()
    fireEvent.click(screen.getByRole("button", { name: "Back" }))
    expect(frame).toHaveAttribute("src", "http://localhost:4321/")
    expect(address).toHaveValue("http://localhost:4321/")
    fireEvent.click(screen.getByRole("button", { name: "Forward" }))
    expect(frame).toHaveAttribute("src", "http://localhost:4321/settings?tab=account#profile")
    fireEvent.click(screen.getByRole("button", { name: "Dark appearance" }))
    expect(frame).toHaveStyle({ colorScheme: "dark", backgroundColor: "var(--hub-canvas-default)" })
    expect(view.container.querySelector(".canvas-base")).toHaveAttribute("data-color-mode", "dark")
    expect(view.container.querySelector(".canvas-shell")).not.toHaveAttribute("style")
    view.unmount()
  })
  it.each([
    ["button", "http://localhost:4321/", "/settings?tab=account"],
    ["button", "http://localhost:4321/#/settings", "/#/profile"],
    ["address", "http://localhost:4321/#/settings", "/#/profile"],
  ])(
    "reloads a fresh frame through %s at %s and reconnects its bridge",
    (control, prototypeUrl, currentRoute) => {
      vi.stubGlobal(
        "fetch",
        vi.fn((path: string) =>
          Promise.resolve(
            new Response(
              JSON.stringify(
                isHubStatusRequest(path) ? { state: "unconfigured" } : publicationState,
              ),
            ),
          ),
        ),
      )
      const nonce = "00000000-0000-4000-8000-000000000004"
      vi.spyOn(crypto, "randomUUID").mockReturnValue(nonce)
      const view = render(<App config={{ name: "Demo", prototypeUrl, token: "local" }} />)
      const original = screen.getByTitle("Demo prototype")
      if (!(original instanceof HTMLIFrameElement)) throw new Error("Expected a preview frame.")
      function report(frame: HTMLIFrameElement, url: URL) {
        act(() => {
          window.dispatchEvent(
            new MessageEvent("message", {
              origin: "http://localhost:4321",
              source: frame.contentWindow,
              data: {
                type: "replica:canvas:ready",
                nonce,
                protocolVersion: 1,
                route: { pathname: url.pathname, search: url.search, hash: url.hash },
              },
            }),
          )
        })
      }
      const destination = new URL(currentRoute, prototypeUrl)
      report(original, destination)
      const address = screen.getByRole("textbox", { name: "Prototype address" })
      expect(address).toHaveValue(destination.href)
      fireEvent.click(screen.getByRole("button", { name: "Dark appearance" }))
      const oldWindow = original.contentWindow

      if (control === "button")
        fireEvent.click(screen.getByRole("button", { name: "Reload preview" }))
      else fireEvent.submit(address.closest("form")!)

      const replacement = screen.getByTitle("Demo prototype")
      if (!(replacement instanceof HTMLIFrameElement)) throw new Error("Expected a preview frame.")
      expect(replacement).not.toBe(original)
      expect(original).not.toBeInTheDocument()
      expect(replacement.contentWindow).not.toBe(oldWindow)
      expect(replacement).toHaveAttribute("src", destination.href)
      expect(replacement).toHaveStyle({ colorScheme: "dark" })
      expect(address).toHaveValue(destination.href)
      expect(screen.getByRole("button", { name: "Back" })).toBeEnabled()
      expect(screen.getByRole("button", { name: "Forward" })).toBeDisabled()

      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            origin: "http://localhost:4321",
            source: oldWindow,
            data: {
              type: "replica:canvas:ready",
              nonce,
              protocolVersion: 1,
              route: { pathname: "/stale", search: "", hash: "" },
            },
          }),
        )
      })
      expect(address).toHaveValue(destination.href)
      fireEvent.load(replacement)
      destination.hash = "#updated"
      report(replacement, destination)
      expect(address).toHaveValue(destination.href)

      fireEvent.click(screen.getByRole("button", { name: "Reload preview" }))
      const next = screen.getByTitle("Demo prototype")
      expect(next).not.toBe(replacement)
      expect(next).toHaveAttribute("src", destination.href)
      view.unmount()
    },
  )
  it.each([
    ["unconfigured", undefined, "/local", "/local"],
    ["undiscovered", undefined, "/#/local", "/#/local"],
    ["unavailable", undefined, "/local", "/local"],
    ["connected", { startPage: null, startPageSet: false }, "/local", "/local"],
    ["connected", { startPage: "/hub", startPageSet: true }, "/local", "/hub"],
    ["connected", { startPage: null, startPageSet: true }, "/local", "/"],
    ["connected", { startPage: null }, "/local", "/"],
  ])(
    "uses initial start-page precedence for %s with %j",
    async (state, prototype, localStartPage, expected) => {
      vi.stubGlobal(
        "fetch",
        vi.fn((input: RequestInfo | URL) => {
          if (input === "/api/hub/events") throw new Error("No live connection")
          const data = isHubStatusRequest(input)
            ? {
                ...publicationHub,
                state,
                prototype: prototype ? { ...publicationHub.prototype, ...prototype } : undefined,
                localStartPage,
              }
            : input === "/api/hub/comments"
              ? { comments: [], hasMore: false, nextCursor: null }
              : publicationState
          return Promise.resolve(new Response(JSON.stringify(data)))
        }),
      )
      const view = render(
        <App config={{ name: "Local", prototypeUrl: "http://localhost:4321/", token: "local" }} />,
      )
      await waitFor(() =>
        expect(screen.getByTitle("Local prototype")).toHaveAttribute(
          "src",
          `http://localhost:4321${expected}`,
        ),
      )
      view.unmount()
    },
  )
})

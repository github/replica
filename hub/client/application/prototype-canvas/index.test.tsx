import { act, fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { controlsProtocol, controlsProtocolVersion } from "@utils/prototype-controls-protocol"
import { publicationState } from "@utils/resolve-prototype-publication/fixtures"
import { sharingFixture } from "./tests/sharing-fixture"
import { isHubStatusRequest } from "./tests/is-hub-status-request"
import { App } from "."

describe("App()", () => {
  it("dispatches local controls failure evidence to the current chat without saving values or repairing", async () => {
    vi.useFakeTimers()
    const epoch = "e6a1f4e0-45af-4da8-a66c-538d52e355f9"
    vi.spyOn(crypto, "randomUUID").mockReturnValue(epoch)
    const { fetch } = sharingFixture()
    const respond = fetch.getMockImplementation()!
    fetch.mockImplementation((path: string) =>
      path === "/api/controls/diagnose"
        ? Promise.resolve(new Response(JSON.stringify({ requested: true })))
        : respond(path),
    )
    const view = render(
      <App config={{ name: "Demo", prototypeUrl: "http://localhost:4321/page", token: "local" }} />,
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000)
    })
    fireEvent.click(screen.getByRole("button", { name: "Controls" }))
    expect(screen.getByText("Local controls couldn't connect.")).toBeVisible()
    expect(
      screen.getByText(
        "The preview has not responded to controls. Retry the connection or ask Copilot to diagnose the cause.",
      ),
    ).toBeVisible()
    const input = screen.getByRole("textbox", { name: "Prototype address" })
    fireEvent.change(input, { target: { value: "/settings?view=demo" } })
    fireEvent.submit(input.closest("form")!)
    const frame = screen.getByTitle("Demo prototype")
    if (!(frame instanceof HTMLIFrameElement)) throw new Error("Expected the prototype frame.")
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "http://localhost:4321",
          source: frame.contentWindow,
          data: {
            protocol: controlsProtocol,
            version: controlsProtocolVersion,
            type: "snapshot",
            epoch,
            requestId: "runtime-error",
            sequence: 1,
            state: {
              status: "invalid-config",
              runtimeAvailable: false,
              scopes: [],
              error: "Action failed with PRIVATE_ACTION_CONTROL_VALUE.",
            },
          },
        }),
      )
    })
    expect(screen.getByText("Action failed with PRIVATE_ACTION_CONTROL_VALUE.")).toBeVisible()
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Diagnose with Copilot" }))
      await Promise.resolve()
    })
    const dispatches = fetch.mock.calls.filter(([path]) => path === "/api/controls/diagnose")
    expect(dispatches).toHaveLength(1)
    const options = dispatches[0]?.[1]
    expect(options).toBeDefined()
    if (!options) throw new Error("Diagnosis must send failure evidence.")
    expect(options.method).toBe("POST")
    expect(options.headers).toMatchObject({ "X-Replica-Canvas-Token": "local" })
    if (typeof options.body !== "string") throw new Error("Diagnosis evidence must be JSON.")
    expect(JSON.parse(options.body)).toEqual({
      status: "invalid-config",
      runtimeAvailable: false,
      reconnectRequired: false,
      hasError: true,
      hasStorageError: false,
      previewUrl: "http://localhost:4321/settings?view=demo",
    })
    expect(options.body).not.toContain("secret")
    expect(options.body).not.toContain("PRIVATE_CONTROL_VALUE")
    expect(options.body).not.toContain("PRIVATE_ACTION_CONTROL_VALUE")
    expect(screen.getByRole("button", { name: "Requested in chat" })).toBeDisabled()
    expect(fetch.mock.calls.filter(([path]) => path === "/api/controls")).toHaveLength(0)
    view.unmount()
  })
  it("updates preview and panel offsets when the toolbar wraps and shrinks again", () => {
    let height = 44
    const resizeCallbacks: (() => void)[] = []
    const disconnect = vi.fn()
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resizeCallbacks.push(callback)
        }
        observe = vi.fn()
        unobserve = vi.fn()
        disconnect = disconnect
      },
    )
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.matches(".canvas-toolbar") ? new DOMRect(0, 40, 390, height) : new DOMRect()
    })
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(JSON.stringify(publicationState)))),
    )
    const view = render(
      <App config={{ name: "Demo", prototypeUrl: "http://localhost:4321/", token: "local" }} />,
    )
    const shell = view.container.querySelector<HTMLElement>(".canvas-shell")!
    expect(shell.style.getPropertyValue("--canvas-toolbar-height")).toBe("44px")
    height = 88
    act(() => resizeCallbacks.forEach((callback) => callback()))
    expect(shell.style.getPropertyValue("--canvas-toolbar-height")).toBe("88px")
    height = 44
    act(() => resizeCallbacks.forEach((callback) => callback()))
    expect(shell.style.getPropertyValue("--canvas-toolbar-height")).toBe("44px")
    view.unmount()
    expect(disconnect).toHaveBeenCalledOnce()
  })
  it("reopens collapsed controls without remounting or navigating the prototype", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((path: string) =>
        Promise.resolve(
          new Response(
            JSON.stringify(isHubStatusRequest(path) ? { state: "unconfigured" } : publicationState),
          ),
        ),
      ),
    )
    const view = render(
      <App
        config={{ name: "Demo", prototypeUrl: "http://localhost:4321/#/dashboard", token: "local" }}
      />,
    )
    const frame = screen.getByTitle("Demo prototype")
    const controls = screen.getByRole("button", { name: "Controls" })
    fireEvent.click(controls)
    await screen.findByRole("complementary", { name: "Controls" })
    expect(view.container.querySelector(".canvas-shell .canvas-controls-panel")).not.toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Collapse controls" }))
    fireEvent.click(controls)
    expect(screen.queryByRole("complementary", { name: "Controls" })).not.toBeInTheDocument()
    fireEvent.click(controls)
    expect(screen.getByRole("button", { name: "Expand controls" })).toHaveAttribute(
      "aria-expanded",
      "false",
    )
    expect(screen.getByTitle("Demo prototype")).toBe(frame)
    expect(frame).toHaveAttribute("src", "http://localhost:4321/#/dashboard")
    view.unmount()
  })
})

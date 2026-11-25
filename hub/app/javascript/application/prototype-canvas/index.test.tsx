import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type * as AnnotationShortcut from "@utils/is-annotation-shortcut"
import { controlsProtocol, controlsProtocolVersion } from "@utils/prototype-controls-protocol"
import { publicationState } from "@utils/resolve-prototype-publication/fixtures"
import { sharingFixture } from "./tests/sharing-fixture"
import { isHubStatusRequest } from "./tests/is-hub-status-request"
import { App } from "."

vi.mock("@utils/is-annotation-shortcut", async (importOriginal) => {
  const actual = await importOriginal<typeof AnnotationShortcut>()
  const { asTrustedKeyboardEvent } = await import("@/test/as-trusted-keyboard-event")
  return {
    ...actual,
    isAnnotationShortcut(event: KeyboardEvent, shortcut?: "s" | "c" | "o", shiftKey = false) {
      return actual.isAnnotationShortcut(asTrustedKeyboardEvent(event), shortcut, shiftKey)
    },
  }
})

describe("App()", () => {
  it("toggles Options with O without navigating the preview or taking over typing and overlays", async () => {
    sharingFixture()
    const view = render(
      <App
        config={{ name: "Demo", prototypeUrl: "http://localhost:4321/#/dashboard", token: "local" }}
      />,
    )
    const frame = screen.getByTitle("Demo prototype")
    const toggle = screen.getByRole("button", { name: "Options" })
    expect(toggle).toHaveAttribute("aria-keyshortcuts", "O")
    expect(toggle).toHaveAttribute("aria-expanded", "false")
    const address = screen.getByRole("textbox", { name: "Prototype address" })
    fireEvent.keyDown(address, { key: "o" })
    expect(toggle).toHaveAttribute("aria-expanded", "false")

    fireEvent.keyDown(window, { key: "o" })
    await screen.findByRole("complementary", { name: "Options" })
    expect(toggle).toHaveAttribute("aria-expanded", "true")
    fireEvent.keyDown(window, { key: "O" })
    expect(toggle).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByRole("complementary", { name: "Options" })).not.toBeInTheDocument()
    for (const role of ["menu", "dialog"]) {
      const overlay = document.createElement("div")
      overlay.setAttribute("role", role)
      document.body.append(overlay)
      fireEvent.keyDown(window, { key: "o" })
      expect(toggle).toHaveAttribute("aria-expanded", "false")
      overlay.remove()
    }

    fireEvent.click(screen.getByRole("button", { name: "Edit details" }))
    await screen.findByRole("complementary", { name: "Hub" })
    fireEvent.keyDown(window, { key: "o" })
    expect(toggle).toHaveAttribute("aria-expanded", "false")
    fireEvent.click(screen.getByRole("button", { name: "Close Hub" }))
    fireEvent.keyDown(window, { key: "o" })
    expect(toggle).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByTitle("Demo prototype")).toBe(frame)
    expect(frame).toHaveAttribute("src", "http://localhost:4321/#/dashboard")
    view.unmount()
  })

  it("accepts Options messages only from the focused current preview during user activation", async () => {
    const nonce = "00000000-0000-4000-8000-000000000003"
    vi.spyOn(crypto, "randomUUID").mockReturnValue(nonce)
    sharingFixture()
    const view = render(
      <App
        config={{
          name: "Demo",
          prototypeUrl: "http://localhost:4321/",
          previewUrl: "http://127.0.0.1:6789/",
          token: "local",
        }}
      />,
    )
    const toggle = screen.getByRole("button", { name: "Options" })
    const element = screen.getByTitle("Demo prototype")
    if (!(element instanceof HTMLIFrameElement)) throw new Error("Expected the prototype iframe.")
    const frame = element
    const origin = new URL(frame.src).origin
    const post = vi.spyOn(frame.contentWindow!, "postMessage")
    fireEvent.load(frame)
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "replica:canvas:request-ready",
          nonce,
          optionsShortcut: true,
        }),
        origin,
      ),
    )
    function receive(
      eventOrigin = origin,
      eventNonce = nonce,
      source: Window | null = frame.contentWindow,
    ) {
      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            source,
            origin: eventOrigin,
            data: { type: "replica:canvas:options-shortcut", nonce: eventNonce },
          }),
        )
      })
    }
    const activation = { hasBeenActive: true, isActive: false }
    Object.defineProperty(navigator, "userActivation", { configurable: true, value: activation })
    try {
      activation.isActive = true
      act(() => frame.focus())
      receive()
      expect(toggle).toHaveAttribute("aria-expanded", "false")
      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            source: frame.contentWindow,
            origin,
            data: { type: "replica:canvas:ready", nonce, protocolVersion: 1 },
          }),
        )
      })
      activation.isActive = false
      receive()
      expect(toggle).toHaveAttribute("aria-expanded", "false")
      activation.isActive = true
      act(() => toggle.focus())
      receive()
      expect(toggle).toHaveAttribute("aria-expanded", "false")
      act(() => frame.focus())
      receive("http://localhost:4321")
      expect(toggle).toHaveAttribute("aria-expanded", "false")
      receive(origin, "stale")
      expect(toggle).toHaveAttribute("aria-expanded", "false")
      receive(origin, nonce, window)
      expect(toggle).toHaveAttribute("aria-expanded", "false")

      receive()
      expect(toggle).toHaveAttribute("aria-expanded", "true")
      act(() => frame.focus())
      receive()
      expect(toggle).toHaveAttribute("aria-expanded", "false")
      view.unmount()
      expect(post).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "replica:canvas:request-ready",
          nonce,
          optionsShortcut: false,
        }),
        origin,
      )
    } finally {
      Reflect.deleteProperty(navigator, "userActivation")
      view.unmount()
    }
  })

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
    fireEvent.click(screen.getByRole("button", { name: "Options" }))
    expect(screen.getByText("Local options couldn't connect.")).toBeVisible()
    expect(
      screen.getByText(
        "The preview has not responded to options. Retry the connection or ask Copilot to diagnose the cause.",
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
    const controls = screen.getByRole("button", { name: "Options" })
    fireEvent.click(controls)
    await screen.findByRole("complementary", { name: "Options" })
    expect(view.container.querySelector(".canvas-shell .canvas-controls-panel")).not.toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Collapse options" }))
    fireEvent.click(controls)
    expect(screen.queryByRole("complementary", { name: "Options" })).not.toBeInTheDocument()
    fireEvent.click(controls)
    expect(screen.getByRole("button", { name: "Expand options" })).toHaveAttribute(
      "aria-expanded",
      "false",
    )
    expect(screen.getByTitle("Demo prototype")).toBe(frame)
    expect(frame).toHaveAttribute("src", "http://localhost:4321/#/dashboard")
    view.unmount()
  })
})

import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { createControls } from "@utils/prototype-controls/controls.mjs"
import { controlsEnvelope, type ControlsEnvelope } from "@utils/prototype-controls-protocol"
import { scopeProjection } from "@utils/prototype-controls-protocol/scope-projection"
import { MAXIMUM_PREVIEW_URL_LENGTH } from "@hooks/use-local-preview-route/constants"

import { BrowserPrototypePreview } from "."

function connectPrototype(frame: HTMLIFrameElement, controller: ReturnType<typeof createControls>) {
  const messages: ControlsEnvelope[] = []
  let sequence = 0
  const document = frame.contentDocument!
  if (!document.body) {
    const html = document.createElement("html")
    html.append(document.createElement("body"))
    document.append(html)
  }
  const heading = document.createElement("h1")
  document.body.append(heading)
  function updateHeading() {
    heading.textContent = String(controller.getSnapshot().values.title)
  }
  updateHeading()
  const release = controller.subscribe(updateHeading)
  const post = vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation((data: unknown) => {
    if (!controlsEnvelope(data)) return
    messages.push(data)
    queueMicrotask(() => {
      const command = data.command
      if (command?.operation === "restore" && typeof command.values?.title === "string")
        controller.restore({ title: command.values.title })
      if (command?.operation === "update" && typeof command.value === "string")
        controller.update(command.id!, command.value)
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: new URL(frame.src).origin,
          source: frame.contentWindow,
          data: {
            protocol: "replica:controls",
            version: 1,
            epoch: data.epoch,
            requestId: data.requestId,
            type: "reply",
            sequence: ++sequence,
            state: {
              runtimeAvailable: true,
              status: "ready",
              scopes: [scopeProjection(controller)],
            },
          },
        }),
      )
    })
  })
  fireEvent.load(frame)
  return { messages, heading, post, release }
}

describe("BrowserPrototypePreview()", () => {
  it("starts with expanded usable options and keeps the interactive frame through edits and folding", async () => {
    vi.useFakeTimers()
    const fetch = vi.fn()
    vi.stubGlobal("fetch", fetch)
    const controller = createControls({
      version: 1,
      scope: "browserPanel",
      controls: [{ id: "title", label: "Title", type: "text", default: "Default" }],
    })
    const target = new URL("http://localhost:3000/settings?view=compact#details")
    target.searchParams.set("rc.browserPanel.title", JSON.stringify("Saved"))
    const wrapper = new URL("/browser?document=browser-only", window.location.origin)
    wrapper.searchParams.set("url", target.href)
    window.history.replaceState(null, "", wrapper)
    const config = {
      surface: "browser" as const,
      prototypeUrl: target.href,
      previewUrl: "http://127.0.0.1:4321/",
      name: "Demo",
    }
    const view = render(<BrowserPrototypePreview config={config} />)
    const frame = view.container.querySelector("iframe")!
    const source = new URL(frame.src)
    expect(source.origin).toBe(new URL(config.previewUrl).origin)
    expect(source.pathname).toBe(target.pathname)
    expect(source.search).toBe(target.search)
    expect(source.hash).toBe(target.hash)
    const prototype = connectPrototype(frame, controller)
    try {
      await act(() => vi.advanceTimersByTimeAsync(0))
      const options = screen.getByRole("complementary", { name: "Options" })
      expect(within(options).getByRole("button", { name: "Collapse options" })).toHaveAttribute(
        "aria-expanded",
        "true",
      )
      expect(within(options).getByRole("textbox", { name: "Title" })).toBeEnabled()
      expect(controller.getSnapshot().values.title).toBe("Saved")
      expect(prototype.heading).toHaveTextContent("Saved")

      const button = frame.contentDocument!.createElement("button")
      let clicks = 0
      button.textContent = "Prototype action"
      button.onclick = () => {
        clicks++
      }
      frame.contentDocument!.body.append(button)
      fireEvent.click(button)
      expect(clicks).toBe(1)
      fireEvent.change(within(options).getByRole("textbox", { name: "Title" }), {
        target: { value: "Edited" },
      })
      await act(() => vi.advanceTimersByTimeAsync(0))
      expect(controller.getSnapshot().values.title).toBe("Edited")
      expect(prototype.heading).toHaveTextContent("Edited")
      expect(
        prototype.messages.find((message) => message.command?.operation === "update"),
      ).toMatchObject({
        type: "command",
        command: {
          operation: "update",
          scope: "browserPanel",
          id: "title",
          value: "Edited",
        },
      })

      fireEvent.click(within(options).getByRole("button", { name: "Collapse options" }))
      expect(within(options).queryByRole("textbox", { name: "Title" })).not.toBeInTheDocument()
      expect(within(options).getByRole("button", { name: "Expand options" })).toHaveAttribute(
        "aria-expanded",
        "false",
      )
      fireEvent.click(button)
      expect(clicks).toBe(2)
      fireEvent.click(within(options).getByRole("button", { name: "Expand options" }))
      expect(within(options).getByRole("textbox", { name: "Title" })).toHaveValue("Edited")
      expect(view.container.querySelector("iframe")).toBe(frame)
      expect(frame.src).toBe(source.href)
      expect(prototype.heading).toHaveTextContent("Edited")
      expect(fetch).not.toHaveBeenCalled()
      expect(
        screen.queryByRole("button", {
          name: /open with options|publish|share|fix with copilot|add comment|add note|edit details/i,
        }),
      ).not.toBeInTheDocument()
    } finally {
      prototype.release()
      view.unmount()
      window.history.replaceState(null, "", "/")
    }
  })

  it("reports address save failures without interrupting the preview and clears them after recovery", async () => {
    vi.useFakeTimers()
    const controller = createControls({
      version: 1,
      scope: "addressRecovery",
      controls: [{ id: "title", label: "Title", type: "text", default: "Default" }],
    })
    const target = new URL("http://localhost:3000/settings")
    const wrapper = new URL("/browser", window.location.origin)
    wrapper.searchParams.set("url", target.href)
    window.history.replaceState(null, "", wrapper)
    const config = {
      surface: "browser" as const,
      prototypeUrl: target.href,
      previewUrl: "http://127.0.0.1:4321/",
      name: "Demo",
    }
    const view = render(<BrowserPrototypePreview config={config} />)
    const frame = view.container.querySelector("iframe")!
    const source = frame.src
    const prototype = connectPrototype(frame, controller)
    try {
      await act(() => vi.advanceTimersByTimeAsync(0))
      expect(screen.getByRole("textbox", { name: "Title" })).toBeEnabled()
      vi.spyOn(window.history, "replaceState").mockImplementationOnce(() => {
        throw new Error("History is unavailable.")
      })

      const button = frame.contentDocument!.createElement("button")
      let clicks = 0
      button.textContent = "Prototype action"
      button.onclick = () => {
        clicks++
      }
      frame.contentDocument!.body.append(button)
      fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
        target: { value: "Failed" },
      })
      await act(() => vi.advanceTimersByTimeAsync(0))

      expect(screen.getByRole("alert")).toHaveTextContent("History is unavailable.")
      expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue("Failed")
      expect(new URL(window.location.href).searchParams.get("url")).toBe(target.href)
      fireEvent.click(button)
      expect(clicks).toBe(1)
      expect(view.container.querySelector("iframe")).toBe(frame)
      expect(frame.src).toBe(source)

      fireEvent.click(screen.getByRole("button", { name: "Retry saving" }))
      await act(() => vi.advanceTimersByTimeAsync(0))
      fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
        target: { value: "Recovered" },
      })
      await act(() => vi.advanceTimersByTimeAsync(0))
      expect(screen.queryByRole("alert")).not.toBeInTheDocument()
      expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue("Recovered")
      const savedTarget = new URL(new URL(window.location.href).searchParams.get("url")!)
      expect(savedTarget.searchParams.get("rc.addressRecovery.title")).toBe('"Recovered"')
      expect(view.container.querySelector("iframe")).toBe(frame)
      expect(frame.src).toBe(source)
      fireEvent.click(button)
      expect(clicks).toBe(2)
    } finally {
      prototype.release()
      view.unmount()
      window.history.replaceState(null, "", "/")
    }
  })

  it("reloads the current encoded target with edited options and its original route intact", async () => {
    vi.useFakeTimers()
    const controller = createControls({
      version: 1,
      scope: "browserReload",
      controls: [{ id: "title", label: "Title", type: "text", default: "Default" }],
    })
    const target = new URL("http://localhost:3000/items?filter=active#selected")
    const wrapper = new URL("/browser?document=browser-only", window.location.origin)
    wrapper.searchParams.set("url", target.href)
    window.history.replaceState(null, "", wrapper)
    const config = {
      surface: "browser" as const,
      prototypeUrl: target.href,
      previewUrl: "http://127.0.0.1:4321/",
      name: "Demo",
    }
    let view = render(<BrowserPrototypePreview config={config} />)
    let prototype = connectPrototype(view.container.querySelector("iframe")!, controller)
    try {
      await act(() => vi.advanceTimersByTimeAsync(0))
      fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
        target: { value: "A & B" },
      })
      await act(() => vi.advanceTimersByTimeAsync(0))
      const currentWrapper = new URL(window.location.href)
      expect(currentWrapper.pathname).toBe("/browser")
      expect(currentWrapper.searchParams.get("document")).toBe("browser-only")
      const currentTarget = new URL(currentWrapper.searchParams.get("url")!)
      expect(currentTarget.origin).toBe(target.origin)
      expect(currentTarget.pathname).toBe(target.pathname)
      expect(currentTarget.hash).toBe(target.hash)
      expect(currentTarget.searchParams.get("filter")).toBe("active")
      expect(currentTarget.searchParams.get("rc.browserReload.title")).toBe('"A & B"')
      prototype.release()
      view.unmount()
      controller.reset()
      expect(controller.getSnapshot().values.title).toBe("Default")

      view = render(
        <BrowserPrototypePreview config={{ ...config, prototypeUrl: currentTarget.href }} />,
      )
      const reloadedFrame = view.container.querySelector("iframe")!
      prototype = connectPrototype(reloadedFrame, controller)
      await act(() => vi.advanceTimersByTimeAsync(0))
      expect(controller.getSnapshot().values.title).toBe("A & B")
      expect(prototype.heading).toHaveTextContent("A & B")
      expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue("A & B")
      const reloadedSource = new URL(reloadedFrame.src)
      expect(reloadedSource.pathname).toBe(currentTarget.pathname)
      expect(reloadedSource.search).toBe(currentTarget.search)
      expect(reloadedSource.hash).toBe(currentTarget.hash)
      expect(screen.getByRole("button", { name: "Collapse options" })).toHaveAttribute(
        "aria-expanded",
        "true",
      )
    } finally {
      prototype.release()
      view.unmount()
      window.history.replaceState(null, "", "/")
    }
  })

  it("keeps the last reloadable target and reports an error when an option exceeds its URL limit", async () => {
    vi.useFakeTimers()
    const controller = createControls({
      version: 1,
      scope: "browserLimit",
      controls: [{ id: "title", label: "Title", type: "text", default: "Default" }],
    })
    const target = new URL("http://localhost:3000/items?fill=x")
    target.searchParams.set("fill", "x".repeat(13_000))
    expect(target.href.length).toBeLessThan(MAXIMUM_PREVIEW_URL_LENGTH)
    const wrapper = new URL("/browser?document=browser-only", window.location.origin)
    wrapper.searchParams.set("url", target.href)
    window.history.replaceState(null, "", wrapper)
    const config = {
      surface: "browser" as const,
      prototypeUrl: target.href,
      previewUrl: "http://127.0.0.1:4321/",
      name: "Demo",
    }
    const view = render(<BrowserPrototypePreview config={config} />)
    const frame = view.container.querySelector("iframe")!
    const prototype = connectPrototype(frame, controller)
    const originalWrapperUrl = window.location.href
    try {
      await act(() => vi.advanceTimersByTimeAsync(0))
      fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
        target: { value: "x".repeat(1000) },
      })
      await act(() => vi.advanceTimersByTimeAsync(0))

      expect(window.location.href).toBe(originalWrapperUrl)
      expect(screen.getByRole("alert")).toHaveTextContent(
        "The prototype address is too long to save.",
      )
      expect(view.container.querySelector("iframe")).toBe(frame)
    } finally {
      prototype.release()
      view.unmount()
      window.history.replaceState(null, "", "/")
    }
  })

  it("navigates and reloads a long app route while preserving existing options", async () => {
    vi.useFakeTimers()
    const nonce = "00000000-0000-4000-8000-000000000099"
    vi.spyOn(crypto, "randomUUID").mockReturnValue(nonce)
    const controller = createControls({
      version: 1,
      scope: "browserLongRoute",
      controls: [{ id: "title", label: "Title", type: "text", default: "Default" }],
    })
    const target = new URL("http://localhost:3000/start?view=compact#before")
    target.searchParams.set("rc.browserLongRoute.title", JSON.stringify("Kept"))
    const wrapper = new URL("/browser?document=browser-only", window.location.origin)
    wrapper.searchParams.set("url", target.href)
    window.history.replaceState(null, "", wrapper)
    const config = {
      surface: "browser" as const,
      prototypeUrl: target.href,
      previewUrl: "http://127.0.0.1:4321/",
      name: "Demo",
    }
    let view = render(<BrowserPrototypePreview config={config} />)
    let frame = view.container.querySelector("iframe")!
    let prototype = connectPrototype(frame, controller)
    try {
      await act(() => vi.advanceTimersByTimeAsync(0))
      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            origin: new URL(frame.src).origin,
            source: frame.contentWindow,
            data: {
              type: "replica:canvas:ready",
              protocolVersion: 1,
              nonce,
              route: {
                pathname: "/next",
                search: `?search=${"x".repeat(7000)}`,
                hash: "#selected",
              },
              replaceRoute: true,
            },
          }),
        )
      })
      await act(() => vi.advanceTimersByTimeAsync(0))

      const savedTarget = new URL(new URL(window.location.href).searchParams.get("url")!)
      expect(savedTarget.pathname).toBe("/next")
      expect(savedTarget.searchParams.get("search")).toBe("x".repeat(7000))
      expect(savedTarget.searchParams.get("rc.browserLongRoute.title")).toBe('"Kept"')
      expect(savedTarget.hash).toBe("#selected")

      prototype.release()
      view.unmount()
      controller.reset()
      view = render(
        <BrowserPrototypePreview config={{ ...config, prototypeUrl: savedTarget.href }} />,
      )
      frame = view.container.querySelector("iframe")!
      prototype = connectPrototype(frame, controller)
      await act(() => vi.advanceTimersByTimeAsync(0))
      expect(controller.getSnapshot().values.title).toBe("Kept")
      expect(new URL(frame.src).pathname).toBe("/next")
      expect(new URL(frame.src).searchParams.get("search")).toBe("x".repeat(7000))
      expect(new URL(frame.src).searchParams.get("rc.browserLongRoute.title")).toBe('"Kept"')
      expect(new URL(frame.src).hash).toBe("#selected")
    } finally {
      prototype.release()
      view.unmount()
      window.history.replaceState(null, "", "/")
    }
  })
})

import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { createControls } from "@utils/prototype-controls/controls.mjs"
import { controlsEnvelope, type ControlsEnvelope } from "@utils/prototype-controls-protocol"
import { scopeProjection } from "@utils/prototype-controls-protocol/scope-projection"

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
  vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation((data: unknown) => {
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
  return { messages, heading, release }
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
})

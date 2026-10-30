import { ThemeProvider } from "@primer/react-brand/esm"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { useState } from "react"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { createControls } from "@utils/prototype-controls/controls.mjs"
import { scopeProjection } from "@utils/prototype-controls-protocol/scope-projection"
import type { PanelState } from "@utils/prototype-controls-connection"
import { ControlsPanel } from "."
import type { ControlsPanelLayout } from "./types"
import styles from "./styles.css?inline"

const controller = createControls({
  version: 1,
  scope: "floatingPanelTest",
  groups: [{ id: "details", label: "Details" }],
  controls: [{ id: "title", label: "Title", type: "text", default: "Preview", group: "details" }],
})
const connection = {
  command: vi.fn(() => Promise.resolve(undefined)),
  retry: vi.fn(),
  resetAll: vi.fn(() => Promise.resolve()),
}
const ready: PanelState = {
  runtimeAvailable: true,
  status: "ready",
  scopes: [scopeProjection(controller)],
  loading: false,
  resetting: false,
  notice: "",
  error: "",
  storageError: "",
  hasResettableValues: true,
}
let viewport = { width: 800, height: 500 }
const capturePointer = vi.fn()
const releasePointer = vi.fn()
const resizeCallbacks = new Set<() => void>()

class TestPointerEvent extends MouseEvent {
  pointerId: number
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init)
    this.pointerId = init.pointerId ?? 1
  }
}

function Example({
  state = ready,
  onDiagnose,
  diagnosisTarget,
}: {
  state?: PanelState
  onDiagnose?: () => Promise<unknown>
  diagnosisTarget?: string
}) {
  const [open, setOpen] = useState(true)
  const [clicks, setClicks] = useState(0)
  const [layout, setLayout] = useState<ControlsPanelLayout>({
    position: null,
    collapsed: false,
    collapsedGroups: {},
  })
  return (
    <ThemeProvider colorMode="auto">
      <button type="button" onClick={() => setOpen(!open)}>
        Controls
      </button>
      <button type="button" onClick={() => setClicks(clicks + 1)}>
        Prototype clicks: {clicks}
      </button>
      {open ? (
        <ControlsPanel
          state={state}
          connection={connection}
          layout={layout}
          onLayoutChange={setLayout}
          onDiagnose={onDiagnose}
          diagnosisTarget={diagnosisTarget}
        />
      ) : null}
    </ThemeProvider>
  )
}

beforeAll(() => {
  Object.defineProperties(HTMLElement.prototype, {
    showPopover: {
      configurable: true,
      value(this: HTMLElement) {
        if (!this.hasAttribute("popover"))
          throw new Error("Tooltip was focused before popover initialization.")
      },
    },
    hidePopover: { configurable: true, value() {} },
  })
})

beforeEach(() => {
  vi.clearAllMocks()
  resizeCallbacks.clear()
  viewport = { width: 800, height: 500 }
  vi.stubGlobal("PointerEvent", TestPointerEvent)
  vi.stubGlobal(
    "ResizeObserver",
    class implements ResizeObserver {
      private readonly resize: () => void
      constructor(callback: ResizeObserverCallback) {
        this.resize = () => callback([], this)
        resizeCallbacks.add(this.resize)
      }
      observe() {}
      unobserve() {}
      disconnect() {
        resizeCallbacks.delete(this.resize)
      }
    },
  )
  Object.defineProperties(HTMLElement.prototype, {
    setPointerCapture: { configurable: true, value: capturePointer },
    hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
    releasePointerCapture: { configurable: true, value: releasePointer },
  })
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.classList.contains("canvas-controls-layer"))
      return new DOMRect(0, 0, viewport.width, viewport.height)
    if (this.classList.contains("canvas-controls-panel"))
      return new DOMRect(
        this.style.left ? parseFloat(this.style.left) : 16,
        this.style.top ? parseFloat(this.style.top) : 16,
        Math.min(
          Number(this.style.width.match(/(\d+)px/)?.[1] ?? 288),
          Math.max(0, viewport.width - 32),
        ),
        this.dataset.collapsed === "true" ? 48 : 200,
      )
    return new DOMRect()
  })
})

describe("ControlsPanel()", () => {
  it("links to the shared Controls guide only in the genuine empty state", () => {
    const empty: PanelState = { ...ready, scopes: [], status: "no-controls" }
    const view = render(<Example state={empty} />)
    const link = screen.getByRole("link", { name: "Learn more" })
    expect(link).toHaveAttribute(
      "href",
      "https://github.com/github/replica/blob/main/starters/shared/REPLICA.md#prototype-controls",
    )
    expect(link).toHaveAttribute("target", "_blank")
    expect(link).toHaveAttribute("rel", "noopener noreferrer")
    expect(link).toHaveAccessibleName("Learn more")
    expect(screen.getByText(/^No active controls\./)).toBeVisible()
    for (const state of [
      ready,
      { ...empty, loading: true },
      { ...empty, status: "missing-runtime" as const, error: "Connection unavailable" },
      { ...empty, status: "invalid-config" as const },
      { ...empty, storageError: "Could not save" },
      { ...empty, reconnectRequired: true },
      { ...empty, scopeErrors: [{ scope: "settings", error: "Invalid settings" }] },
    ]) {
      view.rerender(<Example state={state} />)
      expect(screen.queryByRole("link", { name: "Learn more" })).not.toBeInTheDocument()
    }
  })

  it("shows loading, concise failures and one explicit fix action, then clears on recovery", async () => {
    const controller = createControls({
      version: 1,
      scope: "panelRecoveryTest",
      controls: [
        { id: "search", label: "Show search", type: "boolean", default: true },
        { id: "title", label: "Title", type: "text", default: "Preview" },
      ],
    })
    const technical = 'The app API "headerPreview" is unavailable.'
    controller.bindingStatus("search", technical)
    controller.bindingStatus("title", "The binding target is missing.")
    const failed = { ...ready, scopes: [scopeProjection(controller)] }
    const onDiagnose = vi.fn(() => Promise.resolve())
    const view = render(<Example state={{ ...failed, loading: true }} onDiagnose={onDiagnose} />)
    expect(screen.getByText("Connecting controls...")).toBeVisible()
    expect(screen.queryByText(technical)).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Fix with Copilot" })).not.toBeInTheDocument()
    expect(onDiagnose).not.toHaveBeenCalled()

    view.rerender(<Example state={failed} onDiagnose={onDiagnose} />)
    expect(screen.getByText("Show search is unavailable")).toBeVisible()
    expect(screen.getByLabelText("Show search")).toBeDisabled()
    expect(screen.getByLabelText("Show search")).toHaveAccessibleDescription(
      "Show search is unavailable",
    )
    expect(screen.getByText("Title is unavailable")).toBeVisible()
    expect(screen.getByText(`Show search: ${technical}`)).not.toBeVisible()
    const disclosure = screen.getByText("Technical details").closest("summary")!
    expect(disclosure).toBeInTheDocument()
    fireEvent.click(disclosure)
    expect(screen.getByText(`Show search: ${technical}`)).toBeVisible()
    expect(screen.getAllByRole("button", { name: "Fix with Copilot" })).toHaveLength(1)
    expect(onDiagnose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Fix with Copilot" }))
    await screen.findByRole("button", { name: "Requested in chat" })
    expect(onDiagnose).toHaveBeenCalledOnce()
    expect(connection.command).not.toHaveBeenCalled()
    expect(connection.retry).not.toHaveBeenCalled()

    act(() => disclosure.focus())
    expect(disclosure).toHaveFocus()
    controller.bindingStatus("search", "")
    controller.bindingStatus("title", "")
    view.rerender(
      <Example
        state={{ ...ready, scopes: [scopeProjection(controller)] }}
        onDiagnose={onDiagnose}
      />,
    )
    expect(screen.getByLabelText("Show search")).toBeEnabled()
    expect(screen.queryByText("Show search is unavailable")).not.toBeInTheDocument()
    expect(screen.queryByText("Technical details")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Move controls" })).toHaveFocus()
    expect(screen.queryByRole("button", { name: "Requested in chat" })).not.toBeInTheDocument()
    expect(onDiagnose).toHaveBeenCalledOnce()
  })

  it("keeps a single header reset icon while collapsed and resets immediately", () => {
    const { container } = render(<Example />)
    const reset = screen.getByRole("button", { name: "Reset all controls" })
    expect(container.querySelector(".canvas-controls-header")).toContainElement(reset)
    expect(reset.querySelector(".octicon-sync")).toBeInTheDocument()
    expect(container.querySelector(".canvas-controls-footer")).not.toBeInTheDocument()
    fireEvent.click(reset)
    expect(connection.resetAll).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole("button", { name: "Collapse controls" }))
    expect(screen.getByRole("button", { name: "Reset all controls" })).toBe(reset)
    fireEvent.click(reset)
    expect(connection.resetAll).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole("button", { name: "Expand controls" }))
    expect(screen.getAllByRole("button", { name: "Reset all controls" })).toHaveLength(1)
  })

  it("disables Reset at defaults and enables it for active, inactive or saved changes", () => {
    const defaults = { ...ready, hasResettableValues: false }
    const view = render(<Example state={defaults} />)
    const reset = screen.getByRole("button", { name: "Reset all controls" })
    expect(reset).toBeDisabled()
    fireEvent.click(reset)
    expect(connection.resetAll).not.toHaveBeenCalled()
    const scope = ready.scopes[0]!
    view.rerender(
      <Example
        state={{
          ...defaults,
          scopes: [
            {
              ...scope,
              snapshot: { ...scope.snapshot, values: { title: "Changed" } },
            },
          ],
        }}
      />,
    )
    expect(reset).toBeEnabled()
    view.rerender(<Example state={ready} />)
    expect(reset).toBeEnabled()
    fireEvent.click(screen.getByRole("button", { name: "Collapse controls" }))
    view.rerender(<Example state={defaults} />)
    expect(reset).toBeDisabled()
  })

  it.each([
    { status: "missing-runtime" as const, runtimeAvailable: false, error: "No response." },
    { status: "unsupported-runtime" as const, runtimeAvailable: false, error: "Incompatible." },
    { status: "invalid-config" as const, error: "Invalid declaration." },
    { storageError: "Storage unavailable." },
    { reconnectRequired: true },
  ])(
    "requests diagnosis without retrying or resetting for $status $storageError",
    async (failure) => {
      const onDiagnose = vi.fn(() => Promise.resolve({ requested: true }))
      render(<Example state={{ ...ready, ...failure }} onDiagnose={onDiagnose} />)
      fireEvent.click(screen.getByRole("button", { name: "Diagnose with Copilot" }))
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Requested in chat" })).toBeDisabled(),
      )
      expect(onDiagnose).toHaveBeenCalledTimes(1)
      expect(connection.retry).not.toHaveBeenCalled()
      expect(connection.resetAll).not.toHaveBeenCalled()
      expect(connection.command).not.toHaveBeenCalled()
    },
  )

  it("shows clearer local copy while preserving Retry connection", () => {
    render(
      <Example
        state={{
          ...ready,
          status: "missing-runtime",
          runtimeAvailable: false,
          error: "No response.",
        }}
        onDiagnose={() => Promise.resolve()}
      />,
    )
    expect(screen.getByText("Local controls couldn't connect.")).toBeVisible()
    fireEvent.click(screen.getByRole("button", { name: "Retry connection" }))
    expect(connection.retry).toHaveBeenCalledTimes(1)
  })

  it("blocks duplicate clicks while chat dispatch is pending", async () => {
    let finish!: () => void
    const onDiagnose = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    render(
      <Example
        state={{ ...ready, storageError: "Storage unavailable." }}
        onDiagnose={onDiagnose}
      />,
    )
    const button = screen.getByRole("button", { name: "Diagnose with Copilot" })
    fireEvent.click(button)
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(onDiagnose).toHaveBeenCalledTimes(1)
    await act(async () => {
      finish()
      await Promise.resolve()
    })
    expect(screen.getByRole("button", { name: "Requested in chat" })).toBeDisabled()
  })

  it("shows dispatch failures and allows a new diagnosis request without claiming success", async () => {
    const onDiagnose = vi
      .fn()
      .mockRejectedValueOnce(new Error("Chat unavailable."))
      .mockResolvedValue({})
    render(
      <Example
        state={{ ...ready, storageError: "Storage unavailable." }}
        onDiagnose={onDiagnose}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Diagnose with Copilot" }))
    expect(await screen.findByText("Chat unavailable.")).toHaveAttribute("role", "alert")
    expect(screen.queryByRole("button", { name: "Requested in chat" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Diagnose with Copilot" }))
    await screen.findByRole("button", { name: "Requested in chat" })
    expect(screen.queryByText("Chat unavailable.")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Retry saving" })).toBeEnabled()
  })

  it("offers no diagnosis for healthy local controls or shared Build panels", () => {
    const { rerender } = render(<Example onDiagnose={() => Promise.resolve()} />)
    expect(screen.queryByRole("button", { name: "Diagnose with Copilot" })).not.toBeInTheDocument()
    rerender(<Example state={{ ...ready, status: "missing-runtime", runtimeAvailable: false }} />)
    expect(screen.getByText("No supported controls runtime found.")).toBeVisible()
    expect(screen.queryByRole("button", { name: "Diagnose with Copilot" })).not.toBeInTheDocument()
  })

  it("does not treat an ordinary action exception as a connection failure", () => {
    render(
      <Example
        state={{ ...ready, error: "Action failed while applying PRIVATE_CONTROL_VALUE." }}
        onDiagnose={() => Promise.resolve()}
      />,
    )
    expect(screen.getByText(/Action failed/)).toBeVisible()
    expect(screen.queryByRole("button", { name: "Diagnose with Copilot" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Retry connection" })).not.toBeInTheDocument()
  })

  it("clears acknowledgments on recovery, changed evidence and route changes without remounting", async () => {
    const onDiagnose = vi.fn(() => Promise.resolve())
    const missing: PanelState = {
      ...ready,
      runtimeAvailable: false,
      status: "missing-runtime",
      error: "No response.",
    }
    const view = render(<Example state={missing} onDiagnose={onDiagnose} />)
    fireEvent.click(screen.getByRole("button", { name: "Diagnose with Copilot" }))
    await screen.findByRole("button", { name: "Requested in chat" })
    view.rerender(<Example state={ready} onDiagnose={onDiagnose} />)
    expect(screen.queryByRole("button", { name: "Requested in chat" })).not.toBeInTheDocument()
    view.rerender(<Example state={missing} onDiagnose={onDiagnose} />)
    expect(screen.getByRole("button", { name: "Diagnose with Copilot" })).toBeEnabled()
    fireEvent.click(screen.getByRole("button", { name: "Diagnose with Copilot" }))
    await screen.findByRole("button", { name: "Requested in chat" })
    const storage = { ...ready, storageError: "Saving failed." }
    view.rerender(<Example state={storage} onDiagnose={onDiagnose} />)
    fireEvent.click(screen.getByRole("button", { name: "Diagnose with Copilot" }))
    await screen.findByRole("button", { name: "Requested in chat" })
    view.rerender(<Example state={storage} diagnosisTarget="/settings" onDiagnose={onDiagnose} />)
    expect(screen.getByRole("button", { name: "Diagnose with Copilot" })).toBeEnabled()
    expect(onDiagnose).toHaveBeenCalledTimes(3)
  })

  it("clears failed dispatch alerts after recovery", async () => {
    const onDiagnose = vi.fn(() => Promise.reject(new Error("Chat unavailable.")))
    const view = render(
      <Example state={{ ...ready, storageError: "Saving failed." }} onDiagnose={onDiagnose} />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Diagnose with Copilot" }))
    await screen.findByText("Chat unavailable.")
    view.rerender(<Example state={ready} onDiagnose={onDiagnose} />)
    expect(screen.queryByText("Chat unavailable.")).not.toBeInTheDocument()
  })

  it.each(["success", "failure"])(
    "ignores an older episode's late %s response",
    async (outcome) => {
      let finish!: () => void
      let fail!: (error: Error) => void
      const onDiagnose = vi.fn(
        () =>
          new Promise<void>((resolve, reject) => {
            finish = resolve
            fail = reject
          }),
      )
      const storage = { ...ready, storageError: "Saving failed." }
      const view = render(<Example state={storage} onDiagnose={onDiagnose} />)
      fireEvent.click(screen.getByRole("button", { name: "Diagnose with Copilot" }))
      view.rerender(<Example state={ready} onDiagnose={onDiagnose} />)
      view.rerender(<Example state={storage} onDiagnose={onDiagnose} />)
      await act(async () => {
        if (outcome === "success") finish()
        else fail(new Error("Earlier dispatch failed."))
        await Promise.resolve()
      })
      expect(screen.getByRole("button", { name: "Diagnose with Copilot" })).toBeEnabled()
      expect(screen.queryByRole("button", { name: "Requested in chat" })).not.toBeInTheDocument()
      expect(screen.queryByText("Earlier dispatch failed.")).not.toBeInTheDocument()
    },
  )

  it("spaces the full-width title and trailing chevron apart with 8px insets despite later Brand styles", () => {
    render(<Example />)
    const title = screen.getByRole("button", { name: "Collapse controls" })
    expect(title).toHaveAttribute("type", "button")
    expect(title.className).toContain("Button--block")
    expect(title).toHaveTextContent("Controls")
    expect(within(title).getByTestId("Button-trailing-visual")).toContainElement(
      title.querySelector(".octicon-chevron-up"),
    )
    const headerRule = [...styles.matchAll(/([^{}]+)\{([^{}]+)\}/g)].find(
      ([, selector]) => selector?.trim() === ".canvas-controls-header .canvas-controls-title",
    )
    if (!headerRule?.[1]) throw new Error("The panel title needs a scoped alignment rule.")
    expect(headerRule[2]).toContain("flex: 1;")
    expect(headerRule[2]).toContain("min-width: 0;")
    expect(headerRule[2]).toContain("justify-content: space-between;")
    expect(headerRule[2]).toContain("padding-inline: var(--hub-space-8);")
    expect(title.matches(headerRule[1].trim())).toBe(true)
  })

  it("keeps the same disclosure, body association, focus and fields through panel folding", () => {
    render(<Example />)
    const title = screen.getByRole("button", { name: "Collapse controls" })
    const body = document.getElementById(title.getAttribute("aria-controls") ?? "")
    const field = screen.getByRole("textbox", { name: "Title" })
    act(() => title.focus())
    expect(title).toHaveAttribute("aria-expanded", "true")
    expect(body).toBeVisible()
    fireEvent.click(title)
    expect(title).toHaveAccessibleName("Expand controls")
    expect(title).toHaveAttribute("aria-expanded", "false")
    expect(title).toHaveFocus()
    expect(body).not.toBeVisible()
    expect(field).toHaveValue("Preview")
    expect(title.querySelector(".octicon-chevron-down")).toHaveAttribute("aria-hidden", "true")
    fireEvent.click(title)
    expect(title).toHaveAccessibleName("Collapse controls")
    expect(title).toHaveAttribute("aria-expanded", "true")
    expect(title).toHaveFocus()
    expect(body).toBeVisible()
    expect(screen.getByRole("textbox", { name: "Title" })).toBe(field)
    expect(field).toHaveValue("Preview")
    expect(connection.command).not.toHaveBeenCalled()
  })

  it("keeps accessible movement instructions without an instructional or native tooltip", () => {
    render(<Example />)
    const handle = screen.getByRole("button", { name: "Move controls" })
    expect(handle).toHaveFocus()
    expect(handle).toHaveAttribute("title", "")
    expect(handle).toHaveAccessibleDescription(
      "Drag to move. Use arrow keys, or Shift and arrow keys for smaller steps.",
    )
    fireEvent.mouseOver(handle)
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument()
    expect(screen.getByText(/Drag to move/)).toHaveClass("hub-visually-hidden")
  })

  it("names failed scopes without disabling valid fields or Reset", () => {
    const view = render(
      <Example
        state={{
          ...ready,
          scopeErrors: [{ scope: "brokenPage", error: "Invalid declaration." }],
        }}
      />,
    )
    expect(screen.getByRole("alert")).toHaveTextContent(
      'Controls scope "brokenPage" did not connect.',
    )
    expect(screen.getByRole("textbox", { name: "Title" })).toBeEnabled()
    expect(screen.getByRole("button", { name: "Reset all controls" })).toBeEnabled()
    fireEvent.click(screen.getByRole("button", { name: "Reset all controls" }))
    expect(connection.resetAll).toHaveBeenCalledOnce()
    expect(screen.getByRole("alert")).toHaveTextContent("Invalid declaration.")
    view.rerender(<Example state={ready} />)
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("offers reconnect and disables Reset and fields when the connection command budget is exhausted", () => {
    render(
      <Example
        state={{
          ...ready,
          reconnectRequired: true,
          error: "Reconnect controls before sending more commands.",
        }}
      />,
    )
    expect(screen.getByRole("textbox", { name: "Title" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Reset all controls" })).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "Retry connection" }))
    expect(connection.retry).toHaveBeenCalledOnce()
  })

  it("is nonmodal, keeps the prototype interactive, and omits close and routine retry buttons", () => {
    render(<Example />)
    expect(screen.getByRole("complementary", { name: "Controls" })).toBeInTheDocument()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Close controls" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Retry connection" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Prototype clicks: 0" }))
    expect(screen.getByRole("button", { name: "Prototype clicks: 1" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Reset all controls" })).toBeEnabled()
    expect(screen.getByRole("button", { name: "Move controls" })).toHaveFocus()
  })

  it("remembers position, panel collapse, and group collapse across toolbar dismissal", () => {
    render(<Example />)
    const handle = screen.getByRole("button", { name: "Move controls" })
    fireEvent.keyDown(handle, { key: "ArrowRight" })
    expect(screen.getByRole("complementary", { name: "Controls" })).toHaveStyle({ left: "26px" })
    fireEvent.click(screen.getByRole("button", { name: "Collapse Details" }))
    expect(screen.getByLabelText("Title")).not.toBeVisible()
    fireEvent.click(screen.getByRole("button", { name: "Collapse controls" }))
    expect(screen.getByRole("button", { name: "Expand controls" })).toHaveAttribute(
      "aria-expanded",
      "false",
    )
    expect(screen.getByRole("button", { name: "Reset all controls" })).toBeEnabled()
    fireEvent.click(screen.getByRole("button", { name: "Controls" }))
    expect(screen.queryByRole("complementary", { name: "Controls" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Controls" }))
    expect(screen.getByRole("complementary", { name: "Controls" })).toHaveStyle({ left: "26px" })
    fireEvent.click(screen.getByRole("button", { name: "Expand controls" }))
    expect(screen.getByRole("button", { name: "Expand Details" })).toHaveAttribute(
      "aria-expanded",
      "false",
    )
    fireEvent.click(screen.getByRole("button", { name: "Expand Details" }))
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue("Preview")
    expect(connection.command).not.toHaveBeenCalled()
  })

  it("captures only the grab handle's pointer and clamps movement to the preview", () => {
    render(<Example />)
    const panel = screen.getByRole("complementary", { name: "Controls" })
    const handle = within(panel).getByRole("button", { name: "Move controls" })
    fireEvent.pointerDown(handle, { pointerId: 4, button: 0, clientX: 30, clientY: 30 })
    expect(capturePointer).toHaveBeenCalledWith(4)
    expect(panel).toHaveAttribute("data-dragging", "true")
    fireEvent.pointerMove(handle, { pointerId: 5, clientX: 500, clientY: 400 })
    expect(panel.style.left).toBe("")
    fireEvent.pointerMove(handle, { pointerId: 4, clientX: 2000, clientY: 2000 })
    expect(panel).toHaveStyle({ left: "512px", top: "300px" })
    fireEvent.pointerMove(handle, { pointerId: 4, clientX: -1000, clientY: -1000 })
    expect(panel).toHaveStyle({ left: "0px", top: "0px" })
    fireEvent.pointerUp(handle, { pointerId: 4 })
    expect(panel).not.toHaveAttribute("data-dragging")
    expect(releasePointer).toHaveBeenCalledWith(4)
  })

  it("cancels dragging and supports fine keyboard movement without dragging text inputs", () => {
    render(<Example />)
    const panel = screen.getByRole("complementary", { name: "Controls" })
    const handle = screen.getByRole("button", { name: "Move controls" })
    fireEvent.pointerDown(screen.getByRole("textbox", { name: "Title" }), {
      button: 0,
      pointerId: 2,
    })
    expect(panel).not.toHaveAttribute("data-dragging")
    fireEvent.pointerDown(handle, { pointerId: 4, button: 0, clientX: 30, clientY: 30 })
    fireEvent.pointerMove(handle, { pointerId: 4, clientX: 130, clientY: 130 })
    fireEvent.pointerCancel(handle, { pointerId: 4 })
    expect(panel).toHaveStyle({ left: "16px", top: "16px" })
    expect(panel).not.toHaveAttribute("data-dragging")
    fireEvent.keyDown(handle, { key: "ArrowDown", shiftKey: true })
    expect(panel).toHaveStyle({ top: "17px" })
    fireEvent.keyDown(handle, { key: "ArrowLeft" })
    expect(panel).toHaveStyle({ left: "6px" })
    fireEvent.keyDown(handle, { key: "Escape" })
    expect(panel).toBeInTheDocument()
  })

  it("reclamps position when the preview shrinks", () => {
    render(<Example />)
    const handle = screen.getByRole("button", { name: "Move controls" })
    fireEvent.pointerDown(handle, { button: 0, pointerId: 3, clientX: 30, clientY: 30 })
    fireEvent.pointerMove(handle, { pointerId: 3, clientX: 530, clientY: 300 })
    fireEvent.pointerUp(handle, { pointerId: 3 })
    viewport = { width: 360, height: 250 }
    act(() => {
      window.dispatchEvent(new Event("resize"))
    })
    expect(screen.getByRole("complementary", { name: "Controls" })).toHaveStyle({
      left: "72px",
      top: "50px",
    })
  })

  it("reclamps after a page requests a wider panel and caps widths to the preview", () => {
    const widerScope = scopeProjection(
      createControls({
        version: 1,
        scope: "widerPanelTest",
        panel: { width: 640 },
        controls: [],
      }),
    )
    const view = render(<Example />)
    const handle = screen.getByRole("button", { name: "Move controls" })
    fireEvent.pointerDown(handle, { button: 0, pointerId: 3, clientX: 30, clientY: 30 })
    fireEvent.pointerMove(handle, { pointerId: 3, clientX: 2000, clientY: 30 })
    fireEvent.pointerUp(handle, { pointerId: 3 })
    view.rerender(<Example state={{ ...ready, scopes: [widerScope] }} />)
    act(() => {
      for (const resize of resizeCallbacks) resize()
    })
    const panel = screen.getByRole("complementary", { name: "Controls" })
    expect(panel).toHaveStyle({ left: "160px" })
    expect(panel.style.width).toBe("min(640px, calc(100% - var(--hub-space-16) * 2))")
    viewport = { width: 360, height: 500 }
    act(() => {
      for (const resize of resizeCallbacks) resize()
    })
    expect(panel).toHaveStyle({ left: "32px" })
  })

  it("keeps the expanded panel in bounds after moving its collapsed header to the bottom", () => {
    render(<Example />)
    fireEvent.click(screen.getByRole("button", { name: "Collapse controls" }))
    const handle = screen.getByRole("button", { name: "Move controls" })
    fireEvent.pointerDown(handle, { button: 0, pointerId: 3, clientX: 30, clientY: 30 })
    fireEvent.pointerMove(handle, { pointerId: 3, clientX: 30, clientY: 1000 })
    fireEvent.pointerUp(handle, { pointerId: 3 })
    expect(screen.getByRole("complementary", { name: "Controls" })).toHaveStyle({ top: "452px" })
    fireEvent.click(screen.getByRole("button", { name: "Expand controls" }))
    act(() => {
      for (const resize of resizeCallbacks) resize()
    })
    expect(screen.getByRole("complementary", { name: "Controls" })).toHaveStyle({ top: "300px" })
  })

  it("restores the origin on Escape during a drag and finishes on lost capture", () => {
    render(<Example />)
    const handle = screen.getByRole("button", { name: "Move controls" })
    const panel = screen.getByRole("complementary", { name: "Controls" })
    fireEvent.pointerDown(handle, { button: 0, pointerId: 3, clientX: 30, clientY: 30 })
    fireEvent.pointerMove(handle, { pointerId: 3, clientX: 100, clientY: 100 })
    fireEvent.keyDown(handle, { key: "Escape" })
    expect(panel).toHaveStyle({ left: "16px", top: "16px" })
    expect(panel).not.toHaveAttribute("data-dragging")
    fireEvent.pointerDown(handle, { button: 0, pointerId: 3, clientX: 30, clientY: 30 })
    fireEvent.pointerMove(handle, { pointerId: 3, clientX: 100, clientY: 100 })
    fireEvent.lostPointerCapture(handle, { pointerId: 3 })
    expect(panel).not.toHaveAttribute("data-dragging")
    fireEvent.pointerMove(handle, { pointerId: 3, clientX: 200, clientY: 200 })
    expect(panel).toHaveStyle({ left: "86px", top: "86px" })
  })

  it("resets presentation state on a fresh mount", () => {
    const view = render(<Example />)
    fireEvent.keyDown(screen.getByRole("button", { name: "Move controls" }), { key: "ArrowRight" })
    fireEvent.click(screen.getByRole("button", { name: "Collapse Details" }))
    fireEvent.click(screen.getByRole("button", { name: "Collapse controls" }))
    view.unmount()
    render(<Example />)
    expect(screen.getByRole("complementary", { name: "Controls" }).style.left).toBe("")
    expect(screen.getByRole("button", { name: "Collapse controls" })).toHaveAttribute(
      "aria-expanded",
      "true",
    )
    expect(screen.getByRole("button", { name: "Collapse Details" })).toHaveAttribute(
      "aria-expanded",
      "true",
    )
  })

  it.each([
    { ...ready, loading: true },
    { ...ready, resetting: true },
    {
      ...ready,
      scopes: [
        {
          ...ready.scopes[0]!,
          snapshot: {
            ...ready.scopes[0]!.snapshot,
            actions: { running: { available: true, busy: true } },
          },
        },
      ],
    },
  ])("disables Reset while loading, resetting, or running an action", (state) => {
    render(<Example state={state} />)
    expect(screen.getByRole("button", { name: "Reset all controls" })).toBeDisabled()
  })

  it.each([
    { ...ready, runtimeAvailable: false, loading: true },
    {
      ...ready,
      runtimeAvailable: false,
      status: "missing-runtime" as const,
      error: "No response.",
    },
    { ...ready, runtimeAvailable: false, status: "unsupported-runtime" as const },
    { ...ready, runtimeAvailable: false, storageError: "Storage unavailable." },
    { ...ready, reconnectRequired: true },
  ])(
    "disables Reset while the controls runtime is disconnected or requires reconnection",
    (state) => {
      render(<Example state={state} />)
      expect(screen.getByRole("button", { name: "Reset all controls" })).toBeDisabled()
    },
  )

  it("shows Reset again after connection and keeps it available for storage-only failures", () => {
    const view = render(
      <Example state={{ ...ready, runtimeAvailable: false, error: "Not connected." }} />,
    )
    expect(screen.getByRole("button", { name: "Reset all controls" })).toBeDisabled()
    view.rerender(<Example state={ready} />)
    expect(screen.getByRole("button", { name: "Reset all controls" })).toBeEnabled()
    view.rerender(<Example state={{ ...ready, storageError: "Saving failed." }} />)
    fireEvent.click(screen.getByRole("button", { name: "Reset all controls" }))
    expect(connection.resetAll).toHaveBeenCalledOnce()
  })

  it("shows contextual recovery only for connection and storage failures", () => {
    const view = render(
      <Example
        state={{
          ...ready,
          runtimeAvailable: false,
          status: "missing-runtime",
          error: "Not connected",
        }}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Retry connection" }))
    expect(connection.retry).toHaveBeenCalledOnce()
    view.rerender(<Example state={{ ...ready, storageError: "Saving failed" }} />)
    expect(screen.queryByRole("button", { name: "Retry connection" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Retry saving" }))
    expect(connection.retry).toHaveBeenCalledTimes(2)
    view.rerender(<Example state={{ ...ready, error: "Action failed" }} />)
    expect(screen.queryByRole("button", { name: /Retry/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Reset all controls" }))
    expect(connection.resetAll).toHaveBeenCalledOnce()
  })
})

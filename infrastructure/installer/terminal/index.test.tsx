import { setImmediate } from "node:timers/promises"
import type { ReactNode } from "react"
import { cleanup, render } from "ink-testing-library"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { configurationFields } from "../config/fields/index.ts"
import { createTerminalUI } from "./index.tsx"

const boundary = vi.hoisted(() => ({
  element: undefined as ReactNode,
  draw: undefined as ((element: ReactNode) => void) | undefined,
  options: undefined as Parameters<typeof import("ink").render>[1],
  unmount: vi.fn<() => void>(),
  waitUntilExit: vi.fn<() => Promise<void>>(),
}))

vi.mock("ink", async (importOriginal) => {
  const ink = await importOriginal<typeof import("ink")>()
  return {
    ...ink,
    render(...args: Parameters<typeof ink.render>): ReturnType<typeof ink.render> {
      const [element, options] = args
      if (options && "stdout" in options) return ink.render(...args)
      boundary.element = element
      boundary.options = options
      return {
        rerender(next) {
          boundary.element = next
          boundary.draw?.(next)
        },
        unmount: boundary.unmount,
        waitUntilExit: boundary.waitUntilExit,
        waitUntilRenderFlush: async () => undefined,
        cleanup() {},
        clear() {},
      }
    },
  }
})

const terminals: ReturnType<typeof createTerminalUI>[] = []

function open(abort: AbortController, options: Parameters<typeof createTerminalUI>[1] = {}) {
  const ui = createTerminalUI(abort, options)
  terminals.push(ui)
  return ui
}

function show() {
  const terminal = render(<>{boundary.element}</>)
  boundary.draw = (element) => terminal.rerender(<>{element}</>)
  boundary.unmount.mockImplementation(terminal.unmount)
  return terminal
}

beforeEach(() => {
  boundary.element = undefined
  boundary.draw = undefined
  boundary.options = undefined
  boundary.unmount.mockReset()
  boundary.waitUntilExit.mockReset().mockResolvedValue(undefined)
})

afterEach(async () => {
  await Promise.all(terminals.splice(0).map((ui) => ui.close()))
  cleanup()
})

it.each(["full-screen", "inline"])(
  "keeps resource-group overflow editable without advancing in %s mode",
  async (mode) => {
    vi.stubEnv("TERM", "xterm")
    vi.stubEnv("INK_SCREEN_READER", "false")
    const abort = new AbortController()
    const ui = open(abort, { fullscreen: mode === "full-screen" })
    const suggested = "synthetic-hub-rg"
    const pending = ui.field!(configurationFields.resourceGroup, suggested)
    const settled = vi.fn()
    void pending.then(settled, settled)
    const terminal = show()
    await vi.waitFor(() => expect(terminal.lastFrame()).toContain(suggested))

    terminal.stdin.write("x")

    await vi.waitFor(() => expect(terminal.lastFrame()).toContain(`${suggested}x`))
    expect(abort.signal.aborted).toBe(false)
    expect(settled).not.toHaveBeenCalled()

    const overflow = `${suggested}x${"a".repeat(91 - suggested.length - 1)}`
    terminal.stdin.write(overflow.slice(suggested.length + 1))

    await vi.waitFor(() => {
      const frame = terminal.lastFrame()!
      const lines = frame.split("\n")
      const inputLine = lines.findIndex((line) => line.includes(overflow))
      expect(inputLine).toBeGreaterThanOrEqual(0)
      expect(lines[inputLine + 1]).toMatch(/Error:.*at most 90 characters \(91 entered\)/)
    })
    expect(abort.signal.aborted).toBe(false)
    expect(settled).not.toHaveBeenCalled()

    terminal.stdin.write("\r")
    await setImmediate()
    expect(terminal.lastFrame()).toContain(overflow)
    expect(settled).not.toHaveBeenCalled()
    expect(abort.signal.aborted).toBe(false)

    terminal.stdin.write("\u007f")
    const corrected = overflow.slice(0, -1)
    await vi.waitFor(() => {
      expect(terminal.lastFrame()).toContain(corrected)
      expect(terminal.lastFrame()).not.toContain("Error:")
    })
    expect(settled).not.toHaveBeenCalled()

    terminal.stdin.write("\r")
    await expect(pending).resolves.toBe(corrected)
    expect(abort.signal.aborted).toBe(false)
  },
)

it("rejects the pending question when Ctrl+C cancels the owned terminal", async () => {
  const abort = new AbortController()
  const ui = open(abort, { fullscreen: false })
  const pending = ui.text("Synthetic question")
  const terminal = show()
  await setImmediate()
  const rejected = expect(pending).rejects.toThrow(/cancel/i)

  terminal.stdin.write("\u0003")

  await rejected
  expect(abort.signal.aborted).toBe(true)
})

it("keeps warning and error notices distinct from ordinary status even after activity rolls over", async () => {
  const abort = new AbortController()
  const ui = open(abort, { fullscreen: false })
  const pending = ui.text("Synthetic question")
  const rejected = expect(pending).rejects.toThrow(/cancel/i)
  const terminal = show()
  await setImmediate()

  ui.notice!("warning", "Synthetic warning requires attention")
  ui.status("Synthetic ordinary activity")
  await vi.waitFor(() => {
    expect(terminal.lastFrame()).toMatch(/warning:.*Synthetic warning requires attention/i)
  })
  expect(ui.summary()).toBe("Synthetic warning requires attention")

  ui.notice!("error", "Synthetic failure requires repair")
  for (let index = 0; index < 25; index++) ui.status(`Synthetic activity ${index}`)
  await vi.waitFor(() => {
    expect(terminal.lastFrame()).toMatch(/error:.*Synthetic failure requires repair/i)
    expect(terminal.lastFrame()).not.toContain("Synthetic warning requires attention")
  })
  expect(ui.summary()).toBe("Synthetic failure requires repair")

  abort.abort()
  await rejected
})

it("does not resolve close until Ink has finished terminal restoration", async () => {
  let restored = () => {}
  boundary.waitUntilExit.mockReturnValue(
    new Promise<void>((resolve) => {
      restored = resolve
    }),
  )
  const ui = open(new AbortController(), { fullscreen: false })
  let closed = false
  const closing = ui.close().then(() => {
    closed = true
  })

  try {
    expect(boundary.unmount).toHaveBeenCalledOnce()
    await setImmediate()
    expect(closed).toBe(false)
  } finally {
    restored()
    await closing
  }

  expect(closed).toBe(true)
})

it.each(["info", "success"] as const)(
  "does not reuse a stale %s notice as the summary after a later failure",
  async (level) => {
    const abort = new AbortController()
    const ui = open(abort, { fullscreen: false })
    ui.notice!(level, "Synthetic earlier step completed")

    abort.abort(new Error("Synthetic later step failed"))

    expect(ui.summary()).toBeUndefined()
    ui.notice!("error", "Synthetic actionable recovery instructions")
    expect(ui.summary()).toBe("Synthetic actionable recovery instructions")
  },
)

it.each(["cloud", "resume"])(
  "shows the startup welcome beside the %s question until the first answer",
  async (question) => {
    vi.stubEnv("TERM", "xterm")
    vi.stubEnv("INK_SCREEN_READER", "false")
    const abort = new AbortController()
    const ui = open(abort)
    ui.welcome!(true)
    const pending =
      question === "cloud"
        ? ui.cloud()
        : ui.select("Resume setup?", [{ label: "Resume setup", value: "resume" }])
    const terminal = show()
    await vi.waitFor(() => expect(terminal.lastFrame()).toContain("GitHub"))

    terminal.stdin.write("\r")
    await expect(pending).resolves.toBe(question === "cloud" ? "azure" : "resume")
    const next = ui.text("Next setup question")
    const rejected = expect(next).rejects.toThrow(/cancel/i)
    await vi.waitFor(() => {
      expect(terminal.lastFrame()).toContain("Next setup question")
      expect(terminal.lastFrame()).not.toContain("GitHub")
    })

    abort.abort()
    await rejected
  },
)

it.each(["inline", "screen reader"])(
  "does not request the alternate screen or show an animated clock in %s mode",
  async (mode) => {
    vi.stubEnv("TERM", "xterm")
    vi.stubEnv("INK_SCREEN_READER", mode === "screen reader" ? "true" : "false")
    const abort = new AbortController()
    const ui = open(abort, { fullscreen: mode !== "inline" })
    ui.welcome!(true)
    const pending = ui.cloud()
    const rejected = expect(pending).rejects.toThrow(/cancel/i)
    const terminal = show()
    await setImmediate()

    expect(boundary.options).toMatchObject({ alternateScreen: false })
    expect(terminal.lastFrame()).not.toMatch(/elapsed\s+\d+:/i)
    expect(terminal.lastFrame()).not.toContain("GitHub")

    abort.abort()
    await rejected
  },
)

it("keeps the first question and its input usable while the welcome banner resizes", async () => {
  vi.stubEnv("TERM", "xterm")
  vi.stubEnv("INK_SCREEN_READER", "false")
  const ui = open(new AbortController())
  ui.welcome!(true)
  const pending = ui.select("Resume setup?", [{ label: "Resume setup", value: "resume" }])
  const settled = vi.fn()
  void pending.then(settled, settled)
  const terminal = show()
  let dimensions = { columns: 80, rows: 36 }
  vi.spyOn(terminal.stdout, "columns", "get").mockImplementation(() => dimensions.columns)
  Object.defineProperty(terminal.stdout, "rows", { get: () => dimensions.rows })
  terminal.stdout.emit("resize")
  await vi.waitFor(() => expect(terminal.lastFrame()).toContain("GitHub"))
  terminal.stdin.write("Res")

  for (const size of [
    { columns: 80, rows: 36, art: true },
    { columns: 60, rows: 24, art: true },
    { columns: 59, rows: 24, art: false },
    { columns: 80, rows: 23, art: false },
  ]) {
    dimensions = size
    terminal.stdout.emit("resize")
    await vi.waitFor(() => {
      const frame = terminal.lastFrame()!
      expect(frame).toContain("Resume setup?")
      expect(frame).toMatch(/Search:\s*Res/)
      expect(frame.includes("GitHub")).toBe(size.art)
      expect(frame.split("\n").length).toBeLessThanOrEqual(size.rows)
    })
  }

  expect(settled).not.toHaveBeenCalled()
  terminal.stdin.write("\r")
  await expect(pending).resolves.toBe("resume")
})

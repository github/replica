import { setImmediate } from "node:timers/promises"
import type { ReactNode } from "react"
import { cleanup, render } from "ink-testing-library"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

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
    await vi.waitFor(() => expect(terminal.lastFrame()).toContain("REPLICA"))

    terminal.stdin.write("\r")
    await expect(pending).resolves.toBe(question === "cloud" ? "azure" : "resume")
    const next = ui.text("Next setup question")
    const rejected = expect(next).rejects.toThrow(/cancel/i)
    await vi.waitFor(() => {
      expect(terminal.lastFrame()).toContain("Next setup question")
      expect(terminal.lastFrame()).not.toContain("REPLICA")
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
    expect(terminal.lastFrame()).not.toContain("REPLICA")

    abort.abort()
    await rejected
  },
)

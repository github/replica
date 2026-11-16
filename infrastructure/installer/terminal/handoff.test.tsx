import { setImmediate } from "node:timers/promises"
import type { ReactNode } from "react"
import { cleanup, render } from "ink-testing-library"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { createTerminalUI } from "./index.tsx"

const boundary = vi.hoisted(() => ({
  element: undefined as ReactNode,
  draw: undefined as ((element: ReactNode) => void) | undefined,
  unmount: vi.fn<() => void>(),
}))

vi.mock("ink", async (importOriginal) => {
  const ink = await importOriginal<typeof import("ink")>()
  return {
    ...ink,
    render(...args: Parameters<typeof ink.render>): ReturnType<typeof ink.render> {
      const [element, options] = args
      if (options && "stdout" in options) return ink.render(...args)
      boundary.element = element
      return {
        rerender(next) {
          boundary.element = next
          boundary.draw?.(next)
        },
        unmount: boundary.unmount,
        waitUntilExit: async () => undefined,
        waitUntilRenderFlush: async () => undefined,
        cleanup() {},
        clear() {},
      }
    },
  }
})

const terminals: {
  abort: AbortController
  ui: ReturnType<typeof createTerminalUI>
}[] = []

function open(fullscreen = false) {
  const abort = new AbortController()
  const ui = createTerminalUI(abort, { fullscreen, postSetup: true })
  terminals.push({ abort, ui })
  const terminal = render(<>{boundary.element}</>)
  boundary.draw = (element) => terminal.rerender(<>{element}</>)
  boundary.unmount.mockImplementation(terminal.unmount)
  return { abort, ui, terminal }
}

beforeEach(() => {
  boundary.element = undefined
  boundary.draw = undefined
  boundary.unmount.mockReset()
})

afterEach(async () => {
  for (const { abort, ui } of terminals.splice(0)) {
    abort.abort()
    await ui.close()
  }
  cleanup()
})

it.each(["confirmation", "text", "choice"] as const)(
  "keeps the next %s keyboard-responsive after submitting a confirmation",
  async (kind) => {
    const { abort, ui, terminal } = open()
    ui.status("Synthetic earlier activity")
    const firstLabel = "First synthetic confirmation"
    const nextLabel = `Next synthetic ${kind}`
    const completed = vi.fn()
    const flow = (async () => {
      const accepted = await ui.confirm(firstLabel)
      const next = await (kind === "confirmation"
        ? ui.confirm(nextLabel)
        : kind === "text"
          ? ui.text(nextLabel)
          : ui.select(nextLabel, [
              { label: "Keep saved progress", value: "keep" },
              { label: "Retry synthetic check", value: "retry" },
            ]))
      completed()
      return { accepted, next }
    })()
    void flow.catch(() => undefined)
    await vi.waitFor(() => expect(terminal.lastFrame()).toContain(firstLabel))
    const submittedAt = terminal.frames.length

    terminal.stdin.write("y")

    await vi.waitFor(() => expect(terminal.lastFrame()).toContain(nextLabel))
    expect(completed).not.toHaveBeenCalled()
    for (const frame of terminal.frames.slice(submittedAt)) {
      expect(frame.includes(firstLabel) || frame.includes(nextLabel)).toBe(true)
      expect(frame).not.toContain("Synthetic earlier activity")
    }

    if (kind === "text") {
      terminal.stdin.write("synthetic-answer")
      await vi.waitFor(() => expect(terminal.lastFrame()).toContain("synthetic-answer"))
    } else if (kind === "choice") {
      terminal.stdin.write("Retry")
      await vi.waitFor(() => expect(terminal.lastFrame()).toMatch(/Search:\s*Retry/))
    }
    terminal.stdin.write("\r")

    await expect(flow).resolves.toEqual({
      accepted: true,
      next: kind === "confirmation" ? false : kind === "text" ? "synthetic-answer" : "retry",
    })
    expect(completed).toHaveBeenCalledOnce()
    expect(abort.signal.aborted).toBe(false)
  },
)

it.each([
  {
    decision: "acceptance",
    key: "y",
    answer: true,
  },
  {
    decision: "default decline",
    key: "\r",
    answer: false,
  },
])(
  "shows a submitted rather than live confirmation during delayed work after $decision",
  async ({ key, answer }) => {
    const { abort, ui, terminal } = open()
    const work = Promise.withResolvers<void>()
    const cancelled = Promise.withResolvers<void>()
    abort.signal.addEventListener("abort", () => cancelled.resolve(), { once: true })
    const started = vi.fn()
    const nextPrompt = vi.fn()
    ui.status("Synthetic earlier activity")
    const label = "Proceed with the synthetic operation?"
    const flow = (async () => {
      const decision = await ui.confirm(label)
      started(decision)
      await Promise.race([work.promise, cancelled.promise])
      abort.signal.throwIfAborted()
      nextPrompt()
      return ui.text("Next synthetic operation")
    })()
    void flow.catch(() => undefined)
    await vi.waitFor(() => {
      expect(terminal.lastFrame()).toContain(label)
      expect(terminal.lastFrame()).toMatch(/\by\/n\b/i)
    })
    const submittedAt = terminal.frames.length

    terminal.stdin.write(key)

    await vi.waitFor(() => expect(started).toHaveBeenCalledExactlyOnceWith(answer))
    try {
      await setImmediate()
      const submittedFrame = terminal.lastFrame()!
      terminal.stdin.write("y")
      await setImmediate()
      const pendingFrame = terminal.lastFrame()!
      expect(started).toHaveBeenCalledOnce()
      expect(nextPrompt).not.toHaveBeenCalled()
      for (const frame of terminal.frames.slice(submittedAt)) {
        expect(frame).toContain(label)
        expect(frame).not.toContain("Synthetic earlier activity")
      }

      work.resolve()
      await vi.waitFor(() => expect(terminal.lastFrame()).toContain("Next synthetic operation"))
      terminal.stdin.write("synthetic-answer")
      await vi.waitFor(() => expect(terminal.lastFrame()).toContain("synthetic-answer"))
      terminal.stdin.write("\r")

      await expect(flow).resolves.toBe("synthetic-answer")
      expect(started).toHaveBeenCalledOnce()
      expect(nextPrompt).toHaveBeenCalledOnce()
      expect(abort.signal.aborted).toBe(false)
      for (const frame of [submittedFrame, pendingFrame]) {
        expect(frame).toContain(label)
        expect(frame).not.toMatch(/\by\/n\b/i)
        expect(frame.slice(frame.indexOf(label) + label.length)).toMatch(
          /\b(?:received|continuing|confirmed|accepted|declined|submitted|recorded|working|processing)\b|please wait/i,
        )
      }
    } finally {
      abort.abort()
      work.resolve()
      await flow.catch(() => undefined)
    }
  },
)

it("keeps Ctrl+C usable while submitted confirmation work is pending and prevents the next prompt", async () => {
  const { abort, ui, terminal } = open()
  const work = Promise.withResolvers<void>()
  const cancelled = Promise.withResolvers<void>()
  abort.signal.addEventListener("abort", () => cancelled.resolve(), { once: true })
  const started = vi.fn()
  const nextPrompt = vi.fn()
  const flow = (async () => {
    started(await ui.confirm("Proceed with the cancellable synthetic operation?"))
    await Promise.race([work.promise, cancelled.promise])
    abort.signal.throwIfAborted()
    nextPrompt()
    return ui.confirm("Consent must not continue after cancellation")
  })()
  void flow.catch(() => undefined)
  await vi.waitFor(() => expect(terminal.lastFrame()).toMatch(/\by\/n\b/i))
  terminal.stdin.write("y")
  await vi.waitFor(() => expect(started).toHaveBeenCalledExactlyOnceWith(true))

  const rejected = expect(flow).rejects.toMatchObject({ name: "AbortError" })
  terminal.stdin.write("\u0003")

  await rejected
  expect(abort.signal.aborted).toBe(true)
  work.resolve()
  await setImmediate()
  expect(nextPrompt).not.toHaveBeenCalled()
  expect(terminal.lastFrame()).not.toContain("Consent must not continue after cancellation")
})

it("keeps pending-work feedback and cancellation visible when the submitted fullscreen answer is scrolled away", async () => {
  vi.stubEnv("TERM", "xterm")
  vi.stubEnv("INK_SCREEN_READER", "false")
  const { abort, ui, terminal } = open(true)
  vi.spyOn(terminal.stdout, "columns", "get").mockReturnValue(80)
  Object.defineProperty(terminal.stdout, "rows", { get: () => 24 })
  terminal.stdout.emit("resize")
  const work = Promise.withResolvers<void>()
  const cancelled = Promise.withResolvers<void>()
  abort.signal.addEventListener("abort", () => cancelled.resolve(), { once: true })
  const started = vi.fn()
  const nextPrompt = vi.fn()
  const heading = "Review the synthetic operation"
  const question = "Approve the synthetic operation?"
  const flow = (async () => {
    started(
      await ui.confirm(
        [
          heading,
          ...Array.from({ length: 36 }, (_, index) => `Synthetic condition ${index + 1}`),
          question,
        ].join("\n"),
      ),
    )
    await Promise.race([work.promise, cancelled.promise])
    abort.signal.throwIfAborted()
    nextPrompt()
  })()
  void flow.catch(() => undefined)
  try {
    await vi.waitFor(() => expect(terminal.lastFrame()).toContain(heading))
    for (let page = 0; page < 4 && !/\by\/n\b/i.test(terminal.lastFrame()!); page++) {
      const previous = terminal.lastFrame()
      terminal.stdin.write("\u001b[6~")
      await vi.waitFor(() => expect(terminal.lastFrame()).not.toBe(previous))
    }
    expect(terminal.lastFrame()).toMatch(/\by\/n\b/i)
    terminal.stdin.write("y")
    await vi.waitFor(() => expect(started).toHaveBeenCalledExactlyOnceWith(true))

    for (let page = 0; page < 4 && !terminal.lastFrame()!.includes(heading); page++) {
      const previous = terminal.lastFrame()
      terminal.stdin.write("\u001b[5~")
      await vi.waitFor(() => expect(terminal.lastFrame()).not.toBe(previous))
    }
    await vi.waitFor(() => {
      const lines = terminal.lastFrame()!.trimEnd().split("\n")
      expect(lines.slice(0, -1).join("\n")).toContain(heading)
      expect(lines.slice(0, -1).join("\n")).not.toContain(question)
      expect(lines.at(-1)).toMatch(/continuing|working|processing|pending|busy|please wait/i)
      expect(lines.at(-1)).toContain("Ctrl+C")
      expect(lines.join("\n")).not.toMatch(/\by\/n\b/i)
      expect(lines.length).toBeLessThanOrEqual(24)
    })

    const rejected = expect(flow).rejects.toMatchObject({ name: "AbortError" })
    terminal.stdin.write("\u0003")

    await rejected
    work.resolve()
    await setImmediate()
    expect(abort.signal.aborted).toBe(true)
    expect(nextPrompt).not.toHaveBeenCalled()
  } finally {
    abort.abort()
    work.resolve()
    await flow.catch(() => undefined)
  }
})

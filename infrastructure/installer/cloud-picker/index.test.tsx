import { setImmediate } from "node:timers/promises"
import { cleanup, render } from "ink-testing-library"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CloudPicker } from "./index.tsx"

afterEach(cleanup)

describe("cloud selection", () => {
  it("shows Azure and the unavailable AWS option, and selects Azure with Enter", async () => {
    const onSelect = vi.fn()
    const terminal = render(<CloudPicker onSelect={onSelect} />)
    await setImmediate()

    expect(terminal.lastFrame()).toContain("Azure")
    expect(terminal.lastFrame()).toMatch(/AWS[^\n]*Coming soon/)
    expect(onSelect).not.toHaveBeenCalled()

    terminal.stdin.write("\r")

    await vi.waitFor(() => expect(onSelect).toHaveBeenCalledExactlyOnceWith("azure"))
  })

  it.each(["\u001b[B", "\u001b[A"])(
    "does not make AWS selectable with arrow key %j",
    async (arrow) => {
      const onSelect = vi.fn()
      const terminal = render(<CloudPicker onSelect={onSelect} />)
      await setImmediate()

      terminal.stdin.write(arrow)
      await setImmediate()
      expect(onSelect).not.toHaveBeenCalled()
      terminal.stdin.write("\r")

      await vi.waitFor(() => expect(onSelect).toHaveBeenCalledExactlyOnceWith("azure"))
    },
  )
})

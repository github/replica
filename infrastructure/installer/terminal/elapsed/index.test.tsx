import { setImmediate } from "node:timers/promises"
import { Box, Text } from "ink"
import { cleanup, render } from "ink-testing-library"
import { afterEach, expect, it, vi } from "vitest"

import { Elapsed } from "./index.tsx"

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

it("uses monotonic elapsed time and keeps it through unrelated question rerenders", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
  const clock = vi.spyOn(performance, "now").mockReturnValue(10_000)
  const wallClock = vi.spyOn(Date, "now").mockReturnValue(1_000_000)
  const terminal = render(
    <Box flexDirection="column">
      <Text>First question</Text>
      <Elapsed started={10_000} animate />
    </Box>,
  )
  await setImmediate()
  expect(terminal.lastFrame()).toContain("00:00")

  clock.mockReturnValue(12_000)
  wallClock.mockReturnValue(9_000_000)
  await vi.advanceTimersByTimeAsync(1_000)
  await setImmediate()
  expect(terminal.lastFrame()).toContain("00:02")

  terminal.rerender(
    <Box flexDirection="column">
      <Text>Next question</Text>
      <Elapsed started={10_000} animate />
    </Box>,
  )
  await setImmediate()
  expect(terminal.lastFrame()).toContain("00:02")
  clock.mockReturnValue(13_000)
  wallClock.mockReturnValue(1)
  await vi.advanceTimersByTimeAsync(1_000)
  await setImmediate()
  expect(terminal.lastFrame()).toContain("00:03")
})

it("stops its owned interval when unmounted", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
  const terminal = render(<Elapsed started={performance.now()} animate />)
  await setImmediate()
  expect(vi.getTimerCount()).toBe(1)

  terminal.unmount()
  await setImmediate()

  expect(vi.getTimerCount()).toBe(0)
})

it("renders no animated clock or interval when animation is disabled, including after a mode change", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
  const terminal = render(<Elapsed started={performance.now()} animate={false} />)
  await setImmediate()
  expect(terminal.lastFrame() ?? "").toBe("")
  expect(vi.getTimerCount()).toBe(0)

  terminal.rerender(<Elapsed started={performance.now()} animate />)
  await setImmediate()
  expect(vi.getTimerCount()).toBe(1)
  terminal.rerender(<Elapsed started={performance.now()} animate={false} />)
  await setImmediate()

  expect(terminal.lastFrame() ?? "").toBe("")
  expect(vi.getTimerCount()).toBe(0)
})

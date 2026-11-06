import { setImmediate } from "node:timers/promises"
import { cleanup, render } from "ink-testing-library"
import { afterEach, expect, it, vi } from "vitest"

import { SearchSelect } from "./index.tsx"

afterEach(cleanup)

it("shows the full list size and visible limit before scrolling to a hidden option", async () => {
  const options = Array.from({ length: 8 }, (_, index) => ({
    label: `Subscription ${index + 1}`,
    value: `id-${index + 1}`,
  }))
  const onChange = vi.fn()
  const terminal = render(<SearchSelect options={options} onChange={onChange} />)
  await setImmediate()

  expect(terminal.lastFrame()).toContain("8 of 8 options")
  expect(terminal.lastFrame()).toContain("5 visible at a time")
  expect(terminal.lastFrame()).toMatch(/scroll/i)
  expect(terminal.lastFrame()).not.toContain("Subscription 6")

  for (let index = 0; index < 5; index++) {
    terminal.stdin.write("\u001b[B")
    await setImmediate()
  }
  await vi.waitFor(() => expect(terminal.lastFrame()).toContain("Subscription 6"))
  terminal.stdin.write("\r")
  await vi.waitFor(() => expect(onChange).toHaveBeenCalledExactlyOnceWith("id-6"))
})

it.each(["pRoDuCtIoN", "8A71"])(
  "filters as the user types %s and selects the original subscription ID",
  async (query) => {
    const onChange = vi.fn()
    const terminal = render(
      <SearchSelect
        options={[
          { label: "Development", value: "2b62-development" },
          { label: "Production", value: "8a71-production" },
          { label: "Staging", value: "3c53-staging" },
        ]}
        onChange={onChange}
      />,
    )
    await setImmediate()

    terminal.stdin.write(query)
    await vi.waitFor(() => {
      expect(terminal.lastFrame()).toContain("1 of 3 options")
      expect(terminal.lastFrame()).toContain("Production")
      expect(terminal.lastFrame()).not.toContain("Development")
      expect(terminal.lastFrame()).not.toContain("Staging")
    })
    expect(onChange).not.toHaveBeenCalled()
    terminal.stdin.write("\r")
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledExactlyOnceWith("8a71-production"))
  },
)

it("does not select a stale option when nothing matches and recovers after clearing", async () => {
  const onChange = vi.fn()
  const terminal = render(
    <SearchSelect
      options={[
        { label: "Development", value: "dev" },
        { label: "Production", value: "prod" },
      ]}
      onChange={onChange}
    />,
  )
  await setImmediate()

  terminal.stdin.write("z")
  await vi.waitFor(() => expect(terminal.lastFrame()).toMatch(/no matching options/i))
  expect(terminal.lastFrame()).toContain("0 of 2 options")
  terminal.stdin.write("\r")
  await setImmediate()
  expect(onChange).not.toHaveBeenCalled()

  terminal.stdin.write("\u007f")
  await vi.waitFor(() => expect(terminal.lastFrame()).toContain("2 of 2 options"))
  terminal.stdin.write("\r")
  await vi.waitFor(() => expect(onChange).toHaveBeenCalledExactlyOnceWith("dev"))
})

it("resets keyboard focus to a matching option when the search changes", async () => {
  const onChange = vi.fn()
  const terminal = render(
    <SearchSelect
      options={[
        { label: "North", value: "north" },
        { label: "South", value: "south" },
        { label: "West", value: "west" },
      ]}
      onChange={onChange}
    />,
  )
  await setImmediate()

  terminal.stdin.write("\u001b[B")
  await setImmediate()
  terminal.stdin.write("West")
  await vi.waitFor(() => expect(terminal.lastFrame()).toContain("1 of 3 options"))
  terminal.stdin.write("\r")
  await vi.waitFor(() => expect(onChange).toHaveBeenCalledExactlyOnceWith("west"))
})

import { setImmediate } from "node:timers/promises"
import { useState } from "react"
import { Text } from "ink"
import { cleanup, render } from "ink-testing-library"
import { afterEach, expect, it, vi } from "vitest"

import { configurationFields } from "../../config/fields/index.ts"
import { FieldPrompt } from "../field/index.tsx"
import { ScrollPanel } from "./index.tsx"

afterEach(cleanup)

it("shows the top of a replacement question in its first frame after scrolling the previous one", async () => {
  const details = Array.from({ length: 16 }, (_, index) => `Detail ${index}`)
  const terminal = render(
    <ScrollPanel height={4} revision={1} feedback={0}>
      <Text>{["Previous question", ...details, "Previous answer"].join("\n")}</Text>
    </ScrollPanel>,
  )
  await vi.waitFor(() => expect(terminal.lastFrame()).toContain("Previous question"))
  for (let page = 0; page < 6; page++) {
    terminal.stdin.write("\u001b[6~")
    await setImmediate()
  }
  await vi.waitFor(() => expect(terminal.lastFrame()).toContain("Previous answer"))
  expect(terminal.lastFrame()).not.toContain("Previous question")
  const replacementAt = terminal.frames.length

  terminal.rerender(
    <ScrollPanel height={4} revision={2} feedback={0}>
      <Text>{"Next question\nNext answer"}</Text>
    </ScrollPanel>,
  )

  await vi.waitFor(() => expect(terminal.lastFrame()).toContain("Next question"))
  const replacementFrames = terminal.frames.slice(replacementAt)
  expect(replacementFrames.length).toBeGreaterThan(0)
  for (const frame of replacementFrames) {
    expect(frame).toContain("Next question")
    expect(frame).toContain("Next answer")
    expect(frame).not.toContain("Previous answer")
  }
})

it("keeps reactive feedback and the edited input reachable in a short viewport", async () => {
  function Form() {
    const [feedback, setFeedback] = useState(0)
    return (
      <ScrollPanel height={4} revision={1} feedback={feedback}>
        <FieldPrompt
          field={{ ...configurationFields.name, help: "Choose 4-20 lowercase characters." }}
          initialValue="ab"
          onSubmit={vi.fn()}
          onError={(error) => {
            throw error
          }}
          onFeedback={() => setFeedback((value) => value + 1)}
        />
      </ScrollPanel>
    )
  }
  const terminal = render(<Form />)
  await setImmediate()
  expect(terminal.lastFrame()).toContain("ab")

  terminal.stdin.write("!")

  await vi.waitFor(() => {
    expect(terminal.lastFrame()).toContain("ab!")
    expect(terminal.lastFrame()).toContain("Error:")
  })
})

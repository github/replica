import { setImmediate } from "node:timers/promises"
import { useState } from "react"
import { cleanup, render } from "ink-testing-library"
import { afterEach, expect, it, vi } from "vitest"

import { configurationFields } from "../../config/fields/index.ts"
import { FieldPrompt } from "../field/index.tsx"
import { ScrollPanel } from "./index.tsx"

afterEach(cleanup)

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

import { setImmediate } from "node:timers/promises"
import { cleanup, render } from "ink-testing-library"
import { afterEach, expect, it, vi } from "vitest"

import { configurationFields } from "../../config/fields/index.ts"
import { FieldPrompt } from "./index.tsx"

afterEach(cleanup)

it("shows help before typing, updates decisive errors beside the input, and keeps invalid submission editable", async () => {
  const field = configurationFields.name
  const onSubmit = vi.fn()
  const onError = vi.fn()
  const onEdit = vi.fn()
  const terminal = render(
    <FieldPrompt field={field} onSubmit={onSubmit} onError={onError} onEdit={onEdit} />,
  )
  await setImmediate()
  expect(terminal.lastFrame()).toContain(field.label)
  expect(terminal.lastFrame()).toContain("4-20")

  terminal.stdin.write("ab")
  await vi.waitFor(() => expect(onEdit).toHaveBeenLastCalledWith("ab"))
  expect(field.editingError?.("ab")).toBeUndefined()
  expect(terminal.lastFrame()).not.toMatch(/error/i)

  terminal.stdin.write("!")
  await vi.waitFor(() => expect(onEdit).toHaveBeenLastCalledWith("ab!"))
  const frame = terminal.lastFrame()!
  const inputLine = frame.split("\n").findIndex((line) => line.includes("ab!"))
  const guidance = frame
    .split("\n")
    .slice(inputLine + 1)
    .join("\n")
  expect(inputLine).toBeGreaterThanOrEqual(0)
  expect(guidance.replace(/\s+/g, " ")).toContain(field.editingError?.("ab!")!)
  terminal.stdin.write("\r")
  await setImmediate()
  expect(onSubmit).not.toHaveBeenCalled()
  expect(onError).not.toHaveBeenCalled()

  terminal.stdin.write("\u007f")
  await setImmediate()
  terminal.stdin.write("\r")
  await setImmediate()
  expect(onSubmit).not.toHaveBeenCalled()
  terminal.stdin.write("cd")
  await vi.waitFor(() => expect(onEdit).toHaveBeenLastCalledWith("abcd"))
  const corrected = terminal.lastFrame()!.split("\n")
  const correctedInput = corrected.findIndex((line) => line.includes("abcd"))
  expect(corrected.slice(correctedInput + 1).join("\n")).not.toMatch(/error/i)
  terminal.stdin.write("\r")
  await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledExactlyOnceWith("abcd"))
  expect(onError).not.toHaveBeenCalled()
})

it("does not truncate or sanitize an invalid pasted value into a valid answer", async () => {
  const field = configurationFields.name
  const onSubmit = vi.fn()
  const onEdit = vi.fn()
  const terminal = render(
    <FieldPrompt field={field} onSubmit={onSubmit} onError={vi.fn()} onEdit={onEdit} />,
  )
  await setImmediate()

  const pasted = `team-hub${"a".repeat(20)}`
  terminal.stdin.write(pasted)
  await vi.waitFor(() => expect(onEdit).toHaveBeenLastCalledWith(pasted))
  terminal.stdin.write("\r")
  await setImmediate()

  expect(onSubmit).not.toHaveBeenCalled()
  expect(terminal.lastFrame()).toContain(pasted)
})

it("clears a rejected credential-bearing registry attempt and submits only the corrected normalized URL", async () => {
  const field = configurationFields.npmRegistry
  const onSubmit = vi.fn()
  const onError = vi.fn()
  const terminal = render(<FieldPrompt field={field} onSubmit={onSubmit} onError={onError} />)
  await setImmediate()
  terminal.stdin.write("https://synthetic-user:synthetic-password@packages.example/npm")
  await setImmediate()
  terminal.stdin.write("\r")
  await vi.waitFor(() => {
    expect(terminal.lastFrame()).not.toContain("synthetic-user")
    expect(terminal.lastFrame()).not.toContain("synthetic-password")
  })
  expect(onSubmit).not.toHaveBeenCalled()
  expect(onError).not.toHaveBeenCalled()

  terminal.stdin.write("https://packages.example/npm")
  await setImmediate()
  terminal.stdin.write("\r")
  await vi.waitFor(() =>
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith("https://packages.example/npm/"),
  )
  expect(JSON.stringify(onError.mock.calls)).not.toContain("synthetic-password")
})

it("reports unexpected parser defects through onError instead of trapping the user in validation", async () => {
  const failure = new TypeError("Synthetic parser defect")
  const onSubmit = vi.fn()
  const onError = vi.fn()
  const terminal = render(
    <FieldPrompt
      field={{
        ...configurationFields.name,
        parse() {
          throw failure
        },
      }}
      initialValue="team-hub"
      onSubmit={onSubmit}
      onError={onError}
    />,
  )
  await setImmediate()

  terminal.stdin.write("\r")

  await vi.waitFor(() => expect(onError).toHaveBeenCalledExactlyOnceWith(failure))
  expect(onSubmit).not.toHaveBeenCalled()
})

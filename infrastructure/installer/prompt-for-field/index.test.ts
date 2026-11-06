import { expect, it, vi } from "vitest"

import { configurationFields } from "../config/fields/index.ts"
import type { WizardUI } from "../types.ts"
import { promptForField } from "./index.ts"

function ui(): WizardUI {
  return {
    cloud: vi.fn(),
    text: vi.fn(),
    select: vi.fn(),
    confirm: vi.fn(),
    status: vi.fn(),
    wait: vi.fn(),
  }
}

it("propagates unexpected parser failures rather than treating them as editable input", async () => {
  const terminal = ui()
  const failure = new TypeError("Synthetic parser defect")
  vi.mocked(terminal.text).mockResolvedValue("test-hub")
  vi.spyOn(configurationFields.name, "parse").mockImplementation(() => {
    throw failure
  })

  await expect(promptForField(terminal, "name")).rejects.toBe(failure)

  expect(terminal.text).toHaveBeenCalledOnce()
  expect(terminal.status).toHaveBeenCalledOnce()
  expect(terminal.wait).not.toHaveBeenCalled()
})

it("keeps a rejected registry credential out of retry state and history even when correction is aborted", async () => {
  const terminal = ui()
  const cancelled = new DOMException("Aborted", "AbortError")
  vi.mocked(terminal.text)
    .mockResolvedValueOnce("https://synthetic-user:synthetic-password@packages.example/npm/")
    .mockRejectedValueOnce(cancelled)

  await expect(promptForField(terminal, "npmRegistry")).rejects.toBe(cancelled)

  expect(terminal.text).toHaveBeenCalledTimes(2)
  expect(vi.mocked(terminal.text).mock.calls[1]![1] ?? "").toBe("")
  const history = JSON.stringify({
    prompts: vi.mocked(terminal.text).mock.calls,
    status: vi.mocked(terminal.status).mock.calls,
    error: cancelled.message,
  })
  expect(history).not.toContain("synthetic-user")
  expect(history).not.toContain("synthetic-password")
  expect(terminal.wait).not.toHaveBeenCalled()
})

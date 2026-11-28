import { describe, expect, it, vi } from "vitest"

import type { PrivatePreviewChoice, WizardUI } from "../types.ts"
import { askPrivatePreview } from "./index.ts"

// Answers each select with the given value, or the first (default) option, and each text in order.
function fakeUI({ selects = [], texts = [] }: { selects?: string[]; texts?: string[] }) {
  return {
    cloud: vi.fn(async () => "azure" as const),
    select: vi.fn(async (_: string, options: { value: string }[]) => selects.shift() ?? options[0]!.value),
    text: vi.fn(async (_message: string, _initial?: string) => texts.shift() ?? ""),
    confirm: vi.fn(),
    wait: vi.fn(),
    status: vi.fn(),
    notice: vi.fn(),
  } satisfies WizardUI
}

describe("askPrivatePreview", () => {
  it("defaults to off and asks only for writer repositories", async () => {
    const ui = fakeUI({})

    await expect(askPrivatePreview(ui, undefined)).resolves.toEqual({
      reader: "off",
      inline: false,
      writerRepositoryIds: [],
    })
    expect(ui.select).toHaveBeenCalledOnce()
    expect(ui.text).toHaveBeenCalledOnce()
  })

  it("offers the saved setting first so an unchanged re-run keeps it", async () => {
    const saved: PrivatePreviewChoice = {
      reader: "on",
      inline: true,
      hostname: "preview.replica.coreai.design",
      writerRepositoryIds: ["123"],
    }
    const ui = fakeUI({ texts: ["preview.replica.coreai.design", "123"] })

    await expect(askPrivatePreview(ui, saved)).resolves.toEqual(saved)
    expect(ui.text.mock.calls.map(([, initial]) => initial)).toEqual(["preview.replica.coreai.design", "123"])
  })

  it("asks again for an invalid hostname or repository list", async () => {
    const ui = fakeUI({
      selects: ["on", "off"],
      texts: ["https://Preview.example.com", "preview.replica.coreai.design", "9223372036854775808", "123, 456"],
    })

    await expect(askPrivatePreview(ui, undefined)).resolves.toEqual({
      reader: "on",
      inline: false,
      hostname: "preview.replica.coreai.design",
      writerRepositoryIds: ["123", "456"],
    })
    expect(ui.notice).toHaveBeenCalledTimes(2)
  })

  it("removes the reader without asking for a hostname or writer repositories", async () => {
    const ui = fakeUI({ selects: ["removed"] })
    const saved: PrivatePreviewChoice = { reader: "on", inline: false, writerRepositoryIds: ["123"] }

    await expect(askPrivatePreview(ui, saved)).resolves.toEqual({
      reader: "removed",
      inline: false,
      writerRepositoryIds: [],
    })
    expect(ui.text).not.toHaveBeenCalled()
  })
})

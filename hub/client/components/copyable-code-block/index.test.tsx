import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CopyableCodeBlock } from "."

describe("CopyableCodeBlock()", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("copies the complete multi-line command", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } })
    const code = "VAULT=example\naz keyvault secret show"
    render(<CopyableCodeBlock code={code} label="Store secrets" />)

    fireEvent.click(screen.getByRole("button", { name: "Copy: Store secrets" }))

    expect(await screen.findByRole("button", { name: "Copied: Store secrets" })).toBeVisible()
    expect(writeText).toHaveBeenCalledWith(code)
  })

  it("explains how to recover when copying fails", async () => {
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    })
    render(<CopyableCodeBlock code="openssl rand -hex 32" label="Generate secret" />)

    fireEvent.click(screen.getByRole("button", { name: "Copy: Generate secret" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("copy it manually")
  })
})

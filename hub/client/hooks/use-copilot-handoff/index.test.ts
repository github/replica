import { act, renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { useCopilotHandoff } from "."

describe("useCopilotHandoff()", () => {
  it("reports a denial when copy fallback has no available copy action", async () => {
    const authorize = vi.fn<() => Promise<boolean | "copy">>().mockResolvedValue("copy")
    const openDialog = vi.fn()
    const { result } = renderHook(() => useCopilotHandoff(authorize))

    await act(() => result.current.prepare(openDialog))

    expect(result.current.error).not.toBeNull()
    expect(openDialog).not.toHaveBeenCalled()
  })
})

import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import { useShareControlSettings } from "."

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

it("defaults off and remembers the choice independently for each prototype", () => {
  const { result, rerender, unmount } = renderHook(
    ({ identity }) => useShareControlSettings(identity, { page: { title: "Configured" } }),
    { initialProps: { identity: "prototype-a" } },
  )
  expect(result.current.included).toBe(false)
  expect(result.current.query).toBe("")
  act(() => result.current.onChange(true))
  expect(new URLSearchParams(result.current.query).get("rc.page.title")).toBe('"Configured"')
  rerender({ identity: "prototype-b" })
  expect(result.current.included).toBe(false)
  rerender({ identity: "prototype-a" })
  expect(result.current.included).toBe(true)
  act(() => result.current.onChange(false))
  unmount()
  const reopened = renderHook(() => useShareControlSettings("prototype-a", {}))
  expect(reopened.result.current.included).toBe(false)
})

it("reports unavailable preference storage but keeps the current choice usable", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Denied")
  })
  const { result } = renderHook(() => useShareControlSettings("prototype-a", {}))
  act(() => result.current.onChange(true))
  expect(result.current.included).toBe(true)
  expect(result.current.error).toMatch(/could not be saved/)
  expect(result.current.blocked).toBe(false)
})

it("reports corrupt preferences and falls back to the declared off default", () => {
  localStorage.setItem("replica:share-controls:v1:prototype-a", "garbage")
  const { result } = renderHook(() => useShareControlSettings("prototype-a", {}))
  expect(result.current.included).toBe(false)
  expect(result.current.error).toMatch(/could not be read/)
})

it("blocks configured link actions when state is too large, without hiding the error", () => {
  const { result } = renderHook(() =>
    useShareControlSettings("prototype-a", { page: { title: "x".repeat(8192) } }),
  )
  act(() => result.current.onChange(true))
  expect(result.current.blocked).toBe(true)
  expect(result.current.error).toMatch(/8 KB/)
  act(() => result.current.onChange(false))
  expect(result.current.blocked).toBe(false)
  expect(result.current.error).toBe("")
})

it("uses the canvas preference transport instead of the ephemeral browser origin", async () => {
  const read = vi.spyOn(Storage.prototype, "getItem")
  const write = vi.spyOn(Storage.prototype, "setItem")
  const save = vi.fn().mockResolvedValue(undefined)
  const { result, rerender } = renderHook(
    ({ included, revision }) =>
      useShareControlSettings("prototype-a", {}, { included, revision, onChange: save }),
    { initialProps: { included: true, revision: "first-context" } },
  )
  expect(result.current.included).toBe(true)
  act(() => result.current.onChange(false))
  await waitFor(() => expect(result.current.pending).toBe(false))
  expect(save).toHaveBeenCalledWith(false)
  expect(result.current.pending).toBe(false)
  expect(read).not.toHaveBeenCalled()
  expect(write).not.toHaveBeenCalled()
  rerender({ included: true, revision: "reopened-context" })
  expect(result.current.included).toBe(true)
})

it("shows canvas persistence failures and does not apply old results to a new context", async () => {
  function notStarted() {
    throw new Error("Request has not started.")
  }
  let rejectSave: (error: Error) => void = notStarted
  let outstanding = Promise.resolve()
  const save = vi.fn(() => {
    outstanding = new Promise<void>((_, reject) => {
      rejectSave = reject
    })
    return outstanding
  })
  const { result, rerender } = renderHook(
    ({ revision }) =>
      useShareControlSettings(
        "prototype-a",
        {},
        {
          included: false,
          revision,
          onChange: save,
        },
      ),
    { initialProps: { revision: "first-context" } },
  )
  act(() => result.current.onChange(true))
  expect(result.current.pending).toBe(true)
  await act(async () => {
    rejectSave(new Error("Preference could not be saved."))
    await expect(outstanding).rejects.toThrow("Preference could not be saved.")
  })
  expect(result.current.error).toMatch(/could not be saved/)
  expect(result.current.included).toBe(true)
  act(() => result.current.onChange(false))
  rerender({ revision: "new-context" })
  await act(async () => {
    rejectSave(new Error("Old request failed."))
    await expect(outstanding).rejects.toThrow("Old request failed.")
  })
  expect(result.current.error).toBe("")
  expect(result.current.pending).toBe(false)
})

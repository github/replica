import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import type { ChecksState } from "@utils/prototype-checks/types"
import { usePrototypeChecks } from "./index"

const fetchMock = vi.fn<typeof globalThis.fetch>()

function response(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200 })
}

beforeEach(() => vi.stubGlobal("fetch", fetchMock))

const state: ChecksState = {
  state: "ready",
  error: null,
  branch: "current",
  checks: [],
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})

it("ignores a slow status response belonging to the previous canvas token", async () => {
  let finish!: (value: Response) => void
  fetchMock
    .mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        finish = resolve
      }),
    )
    .mockResolvedValue(response(state))
  const hook = renderHook(({ token }) => usePrototypeChecks(token), {
    initialProps: { token: "first" },
  })
  hook.rerender({ token: "second" })
  await waitFor(() => expect(hook.result.current.state).toEqual(state))
  await act(async () => {
    finish(response({ ...state, branch: "obsolete" }))
    await Promise.resolve()
  })
  expect(hook.result.current.state?.branch).toBe("current")
})

it("marks previously current results unavailable when polling fails", async () => {
  vi.useFakeTimers()
  fetchMock
    .mockResolvedValueOnce(response(state))
    .mockRejectedValue(new Error("Status unavailable"))
  const hook = renderHook(() => usePrototypeChecks("token"))
  await act(async () => {
    await Promise.resolve()
  })
  expect(hook.result.current.state?.state).toBe("ready")
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2500)
  })
  expect(hook.result.current.error).toBe("Status unavailable")
  expect(hook.result.current.state?.state).toBe("error")
})

it("blocks duplicate actions and does not issue a refresh after unmount", async () => {
  let finish!: (value: Response) => void
  fetchMock.mockResolvedValueOnce(response(state)).mockReturnValueOnce(
    new Promise<Response>((resolve) => {
      finish = resolve
    }),
  )
  const hook = renderHook(() => usePrototypeChecks("token"))
  await waitFor(() => expect(hook.result.current.state).toEqual(state))
  let action!: Promise<boolean>
  act(() => {
    action = hook.result.current.action({ action: "run" })
  })
  expect(await hook.result.current.action({ action: "run" })).toBe(false)
  hook.unmount()
  finish(response({}))
  expect(await action).toBe(false)
  expect(fetchMock).toHaveBeenCalledTimes(2)
})

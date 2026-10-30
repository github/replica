import { describe, expect, it, vi } from "vitest"

const { start, stop } = vi.hoisted(() => ({
  start: vi.fn<() => Promise<ServiceWorkerRegistration | undefined>>(),
  stop: vi.fn<() => void>(),
}))

vi.mock("msw/browser", () => ({
  setupWorker() {
    return { start, stop }
  },
}))

describe("startMockApi()", () => {
  it("stops a partially started worker before surfacing startup failure", async () => {
    const failure = new Error("Service worker registration failed.")
    start.mockRejectedValueOnce(failure)
    const { startMockApi } = await import(".")

    await expect(startMockApi()).rejects.toBe(failure)

    expect(start).toHaveBeenCalledOnce()
    expect(stop).toHaveBeenCalledOnce()
  })
})

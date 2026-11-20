import { EventEmitter } from "node:events"
import { describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  apiStarted: vi.fn(),
  apiStopped: Promise.resolve(),
  forwarders: [] as Array<EventEmitter & { close: ReturnType<typeof vi.fn> }>,
}))

vi.mock("./create-tcp-forwarder/index.ts", () => ({
  createTcpForwarder: vi.fn(() => {
    const forwarder = state.forwarders.shift()
    if (!forwarder) throw new Error("No TCP forwarder fixture is available.")
    return forwarder
  }),
}))

vi.mock("../start-local-api/index.ts", async () => {
  state.apiStarted()
  await state.apiStopped
  return {}
})

function forwarder() {
  return Object.assign(new EventEmitter(), { close: vi.fn() })
}

describe("start decision walkthrough API", () => {
  it("starts the API after the runtime forwarder listens and closes it after the API stops", async () => {
    const runtimeForwarder = forwarder()
    state.forwarders = [runtimeForwarder]
    let stopApi!: () => void
    state.apiStopped = new Promise<void>((resolve) => {
      stopApi = resolve
    })
    state.apiStarted.mockClear()

    const started = import("./index.ts")
    try {
      await vi.waitFor(() => expect(state.forwarders).toHaveLength(0))
      runtimeForwarder.emit("listening")
      await vi.waitFor(() => expect(state.apiStarted).toHaveBeenCalledOnce())
      expect(runtimeForwarder.close).not.toHaveBeenCalled()
    } finally {
      stopApi()
      await Promise.allSettled([started])
    }
    expect(runtimeForwarder.close).toHaveBeenCalledOnce()
  })

  it("closes the forwarder and does not import the API when the listener fails", async () => {
    const runtimeForwarder = forwarder()
    state.forwarders = [runtimeForwarder]
    state.apiStarted.mockClear()
    state.apiStopped = Promise.resolve()

    const started = import("./index.ts")
    await vi.waitFor(() => expect(state.forwarders).toHaveLength(0))
    runtimeForwarder.emit("error", new Error("address already in use"))

    await expect(started).rejects.toThrow("address already in use")
    expect(state.apiStarted).not.toHaveBeenCalled()
    expect(runtimeForwarder.close).toHaveBeenCalledOnce()
  })
})

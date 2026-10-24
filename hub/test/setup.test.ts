import { describe, expect, it, vi } from "vitest"

const environmentKey = "REPLICA_SHARED_SETUP_TEST"
const globalKey = "__replicaSharedSetupTest"
const initialEnvironment = process.env[environmentKey]
const initialGlobal: unknown = Reflect.get(globalThis, globalKey)
const mock = vi.fn((value: string) => value)

describe("shared test setup", () => {
  it.each(["first case", "second case"])(
    "gives the %s clean timers, environment, globals, mocks and modules",
    async () => {
      expect(vi.isFakeTimers()).toBe(false)
      expect(process.env[environmentKey]).toBe(initialEnvironment)
      expect(Reflect.get(globalThis, globalKey)).toBe(initialGlobal)
      expect(mock).not.toHaveBeenCalled()
      expect(mock("fresh implementation")).toBe("fresh implementation")

      const { getWorkerDatabase } = await import("./database/get-worker-database")
      expect(Reflect.has(getWorkerDatabase, globalKey)).toBe(false)

      vi.useFakeTimers()
      setTimeout(() => mock("pending timer"), 1_000)
      vi.stubEnv(environmentKey, "contaminated")
      vi.stubGlobal(globalKey, "contaminated")
      mock.mockReturnValue("contaminated")
      mock("changed implementation")
      Reflect.set(getWorkerDatabase, globalKey, "contaminated")
    },
  )
})

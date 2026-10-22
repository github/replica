import { EventEmitter } from "node:events"
import { resolve } from "node:path"

import { describe, expect, it, vi } from "vitest"

import { analyzeUsage } from "../analyze-usage"
import type { UsageIndex } from "../analyze-usage/types"
import { usagePlugin } from "./index"

vi.mock("../analyze-usage/index.ts", () => ({ analyzeUsage: vi.fn() }))

async function startPlugin() {
  const root = resolve("usage-plugin-fixture")
  const watcher = new EventEmitter()
  const httpServer = new EventEmitter()
  const module = {}
  const server = {
    watcher,
    httpServer,
    ws: { send: vi.fn() },
    moduleGraph: {
      getModuleById: vi.fn(() => module),
      invalidateModule: vi.fn(),
    },
    config: { logger: { error: vi.fn() } },
  }
  const plugin = usagePlugin(root)
  if (typeof plugin.configureServer !== "function" || typeof plugin.load !== "function") {
    throw new Error("Usage plugin hooks are unavailable")
  }
  await plugin.configureServer.call({} as never, server as never)
  const loadHook = plugin.load
  function load() {
    return loadHook.call({} as never, "\0virtual:storybook-component-usage")
  }
  return { root, watcher, httpServer, server, module, load }
}

describe("usagePlugin()", () => {
  it("coalesces source, story metadata, and configuration events without reloading the preview", async () => {
    vi.useFakeTimers()
    const initial: UsageIndex = { components: {}, stories: {} }
    const next: UsageIndex = {
      components: { "app/javascript/components/widget/index.tsx": { consumers: [], surfaces: [] } },
      stories: {},
    }
    vi.mocked(analyzeUsage).mockReturnValueOnce(initial).mockReturnValue(next)
    const { root, watcher, httpServer, server, module, load } = await startPlugin()
    try {
      await load()
      watcher.emit("add", resolve(root, "app/javascript/components/widget/index.tsx"))
      vi.advanceTimersByTime(60)
      watcher.emit("change", resolve(root, "app/javascript/components/widget/stories.tsx"))
      watcher.emit("unlink", resolve(root, "app/views/example.tsx"))
      watcher.emit("change", resolve(root, "tsconfig.json"))
      vi.advanceTimersByTime(99)
      expect(analyzeUsage).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(1)

      expect(analyzeUsage).toHaveBeenCalledTimes(2)
      expect(server.ws.send.mock.calls).toEqual([["storybook/component-usage", next]])
      expect(server.moduleGraph.invalidateModule).toHaveBeenCalledWith(module)
      expect(await load()).toBe(`export default ${JSON.stringify(next)}`)
      expect(analyzeUsage).toHaveBeenCalledTimes(2)
    } finally {
      httpServer.emit("close")
      vi.useRealTimers()
    }
  })

  it("ignores tests, story-only rendering files, unrelated JSON, and dependencies", async () => {
    vi.useFakeTimers()
    vi.mocked(analyzeUsage).mockReturnValue({ components: {}, stories: {} })
    const { root, watcher, httpServer, server, load } = await startPlugin()
    try {
      await load()
      for (const path of [
        "app/javascript/example.test.tsx",
        "app/javascript/example.spec.ts",
        "app/javascript/__tests__/example.tsx",
        "app/javascript/fixtures/example.tsx",
        "app/javascript/test-support/example.tsx",
        "app/javascript/storybook/example.tsx",
        "app/javascript/example.stories.tsx",
        "app/javascript/example.json",
        "node_modules/package/index.ts",
        "../outside.tsx",
      ]) {
        watcher.emit("change", resolve(root, path))
      }
      vi.runAllTimers()
      expect(analyzeUsage).toHaveBeenCalledTimes(1)
      expect(server.ws.send).not.toHaveBeenCalled()
    } finally {
      httpServer.emit("close")
      vi.useRealTimers()
    }
  })

  it("does not notify the preview when a relevant edit leaves the report unchanged", async () => {
    vi.useFakeTimers()
    vi.mocked(analyzeUsage).mockReturnValue({ components: {}, stories: {} })
    const { root, watcher, httpServer, server, load } = await startPlugin()
    try {
      await load()
      watcher.emit("change", resolve(root, "app/javascript/components/widget/index.tsx"))
      vi.runAllTimers()
      expect(analyzeUsage).toHaveBeenCalledTimes(2)
      expect(server.ws.send).not.toHaveBeenCalled()
      expect(server.moduleGraph.invalidateModule).not.toHaveBeenCalled()
    } finally {
      httpServer.emit("close")
      vi.useRealTimers()
    }
  })

  it("refreshes independently for additions, deletions, story metadata, declarations, and tsconfig", async () => {
    vi.useFakeTimers()
    vi.mocked(analyzeUsage).mockReturnValue({ components: {}, stories: {} })
    const { root, watcher, httpServer, load } = await startPlugin()
    try {
      await load()
      const events = [
        ["add", "app/javascript/components/widget/index.ts"],
        ["unlink", "app/views/example.tsx"],
        ["change", "app/javascript/components/widget/stories.tsx"],
        ["change", "app/javascript/types.d.ts"],
        ["change", "tsconfig.json"],
      ] as const
      for (const [event, path] of events) {
        const previousCalls = vi.mocked(analyzeUsage).mock.calls.length
        watcher.emit(event, resolve(root, path))
        vi.runAllTimers()
        expect(analyzeUsage).toHaveBeenCalledTimes(previousCalls + 1)
      }
    } finally {
      httpServer.emit("close")
      vi.useRealTimers()
    }
  })

  it("surfaces analysis failures and recovers on the next source edit", async () => {
    vi.useFakeTimers()
    const next: UsageIndex = { components: {}, stories: { "stories.tsx": [] } }
    vi.mocked(analyzeUsage)
      .mockReturnValueOnce({ components: {}, stories: {} })
      .mockImplementationOnce(() => {
        throw new Error("Invalid tsconfig")
      })
      .mockReturnValueOnce(next)
    const { root, watcher, httpServer, server, load } = await startPlugin()
    try {
      await load()
      watcher.emit("change", resolve(root, "tsconfig.json"))
      vi.runAllTimers()
      expect(server.ws.send.mock.calls[0]?.[0]).toMatchObject({
        type: "error",
        err: { message: "Component usage analysis failed: Invalid tsconfig" },
      })
      expect(server.config.logger.error).toHaveBeenCalled()
      expect(() => load()).toThrow("Invalid tsconfig")
      watcher.emit("change", resolve(root, "tsconfig.json"))
      vi.runAllTimers()
      expect(server.ws.send).toHaveBeenLastCalledWith("storybook/component-usage", next)
      expect(await load()).toBe(`export default ${JSON.stringify(next)}`)
    } finally {
      httpServer.emit("close")
      vi.useRealTimers()
    }
  })

  it("cancels pending analysis and removes its file listeners when the server closes", async () => {
    vi.useFakeTimers()
    vi.mocked(analyzeUsage).mockReturnValue({ components: {}, stories: {} })
    const { root, watcher, httpServer, server, load } = await startPlugin()
    try {
      await load()
      watcher.emit("change", resolve(root, "app/javascript/components/widget/index.tsx"))
      httpServer.emit("close")
      vi.runAllTimers()
      expect(analyzeUsage).toHaveBeenCalledTimes(1)
      expect(server.ws.send).not.toHaveBeenCalled()
      expect(watcher.eventNames()).toEqual([])
    } finally {
      httpServer.emit("close")
      vi.useRealTimers()
    }
  })
})

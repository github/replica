import { relative } from "node:path"

import type { Plugin } from "vite"

import { analyzeUsage } from "../analyze-usage/index.ts"
import type { UsageIndex } from "../analyze-usage/types"

export function usagePlugin(root: string): Plugin {
  const moduleId = "virtual:storybook-component-usage"
  const resolvedId = `\0${moduleId}`
  let usageIndex: UsageIndex | undefined
  let analysisError: Error | undefined
  let cleanup: (() => void) | undefined

  return {
    name: "storybook:component-usage",
    resolveId(id) {
      if (id === moduleId) return resolvedId
    },
    load(id) {
      if (id === resolvedId) {
        if (analysisError) throw analysisError

        usageIndex ??= analyzeUsage(root)
        return `export default ${JSON.stringify(usageIndex)}`
      }
    },
    configureServer(server) {
      let timer: ReturnType<typeof setTimeout> | undefined

      function refresh(file: string) {
        const path = relative(root, file).replaceAll("\\", "/")
        if (path.startsWith("../") || path.includes("/node_modules/")) return
        const isConfig = /(^|\/)tsconfig(?:\.[^/]+)?\.json$/.test(path)
        const isStory = /(^|\/)stories\.tsx$/.test(path)
        const isSource =
          /^(app\/javascript\/|app\/views\/).+\.tsx?$/.test(path) &&
          !/(^|\/)(storybook|test|tests|__tests__|fixtures|__fixtures__|test-support)(\/|$)|\.(test|spec|stories)\.[^.]+$/.test(
            path,
          )
        if ((!isConfig && !isStory && !isSource) || !usageIndex) return

        clearTimeout(timer)
        timer = setTimeout(() => {
          timer = undefined
          try {
            const next = analyzeUsage(root)
            analysisError = undefined
            if (JSON.stringify(next) === JSON.stringify(usageIndex)) return

            usageIndex = next
            const module = server.moduleGraph.getModuleById(resolvedId)
            if (module) server.moduleGraph.invalidateModule(module)
            server.ws.send("storybook/component-usage", next)
          } catch (cause) {
            const error = cause instanceof Error ? cause : new Error(String(cause))
            analysisError = error
            server.config.logger.error(error.stack ?? error.message)
            server.ws.send({
              type: "error",
              err: {
                message: `Component usage analysis failed: ${error.message}`,
                stack: error.stack ?? "",
                plugin: "storybook:component-usage",
              },
            })
          }
        }, 100)
      }

      server.watcher.on("add", refresh).on("change", refresh).on("unlink", refresh)
      cleanup = () => {
        clearTimeout(timer)
        server.watcher.off("add", refresh).off("change", refresh).off("unlink", refresh)
        server.httpServer?.off("close", cleanup!)
      }
      server.httpServer?.once("close", cleanup)
    },
    closeBundle() {
      cleanup?.()
    },
  }
}

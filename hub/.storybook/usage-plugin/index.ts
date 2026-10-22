import type { Plugin } from "vite"

import { analyzeUsage } from "../analyze-usage/index.ts"

export function usagePlugin(root: string): Plugin {
  const moduleId = "virtual:storybook-component-usage"
  const resolvedId = `\0${moduleId}`
  return {
    name: "storybook:component-usage",
    resolveId(id) {
      if (id === moduleId) return resolvedId
    },
    load(id) {
      if (id === resolvedId) return `export default ${JSON.stringify(analyzeUsage(root))}`
    },
    configureServer(server) {
      function refresh(path: string) {
        if (!/\.(tsx?|json)$/.test(path) || path.includes("/node_modules/")) return
        const module = server.moduleGraph.getModuleById(resolvedId)
        if (module) server.moduleGraph.invalidateModule(module)
        server.ws.send({ type: "full-reload" })
      }
      server.watcher.on("add", refresh).on("change", refresh).on("unlink", refresh)
    },
  }
}

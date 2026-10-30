import { createReadStream, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { resolve } from "node:path"
import type { Plugin } from "vite"

const require = createRequire(import.meta.url)

export function mockAssetsPlugin(): Plugin {
  const root = resolve(import.meta.dirname, "app/application/hub/mocks/assets")
  const bridgeSource = readFileSync(
    resolve(import.meta.dirname, "app/features/install-replica-preview-bridge/index.js"),
    "utf8",
  )
  const assets = new Map([
    [
      "/mockServiceWorker.js",
      { path: require.resolve("msw/mockServiceWorker.js"), type: "text/javascript" },
    ],
    ["/mock-previews/example.html", { path: resolve(root, "example.html"), type: "text/html" }],
    ["/mock-previews/desktop.svg", { path: resolve(root, "desktop.svg"), type: "image/svg+xml" }],
    ["/mock-previews/narrow.svg", { path: resolve(root, "narrow.svg"), type: "image/svg+xml" }],
  ])

  return {
    name: "replica:mock-assets",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (!request.url || (request.method !== "GET" && request.method !== "HEAD")) return next()
        const path = new URL(request.url, "http://127.0.0.1").pathname
        if (path === "/mock-previews/bridge.js") {
          response.setHeader("Content-Type", "text/javascript; charset=utf-8")
          response.setHeader("Cache-Control", "no-store")
          const origin = new URL(`http://${request.headers.host}`).origin
          response.end(
            request.method === "HEAD"
              ? undefined
              : bridgeSource.replace('"__REPLICA_HUB_ORIGIN__"', JSON.stringify(origin)),
          )
          return
        }
        const asset = assets.get(path)
        if (!asset) return next()

        response.setHeader("Content-Type", `${asset.type}; charset=utf-8`)
        response.setHeader("Cache-Control", "no-store")
        if (path === "/mockServiceWorker.js") {
          response.setHeader("Service-Worker-Allowed", "/")
        }
        if (request.method === "HEAD") {
          response.end()
          return
        }
        createReadStream(asset.path).on("error", next).pipe(response)
      })
    },
  }
}

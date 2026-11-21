import { createReadStream } from "node:fs"
import { lstat } from "node:fs/promises"
import { createServer } from "node:http"
import path from "node:path"

import { CONTENT_TYPES } from "../constants.mjs"
import { normalizeBasePath } from "../normalize-base-path/index.mjs"

/** Serves checked dist files and falls back to the app entry for browser routes. */
export function createStaticServer(dist, templatePaths = [], basePath = "/") {
  const base = normalizeBasePath(basePath)
  const templatePathnames = new Set(
    templatePaths.map((route) => decodeURIComponent(new URL(route, "http://localhost").pathname)),
  )

  return createServer(async (request, response) => {
    try {
      const rawPath = request.url.split("?")[0]
      const decoded = decodeURIComponent(rawPath)
      if (
        /%2f|%5c/i.test(rawPath) ||
        /[\\\p{Cc}]/u.test(decoded) ||
        decoded.split("/").some((part) => part === "." || part === "..")
      ) {
        response.writeHead(400).end()
        return
      }
      if (base !== "/" && decoded === base.slice(0, -1)) {
        response.writeHead(308, { Location: `${base}${request.url.slice(rawPath.length)}` }).end()
        return
      }
      if (!decoded.startsWith(base)) {
        response.writeHead(404).end()
        return
      }
      const requestPath = `/${decoded.slice(base.length)}`
      const templateNavigation = templatePathnames.has(requestPath)
      const acceptsHtml = request.headers.accept?.includes("text/html")

      if (requestPath === "/favicon.ico" && !(templateNavigation && acceptsHtml)) {
        response.writeHead(204).end()
        return
      }

      const relativePath = requestPath === "/" ? "index.html" : requestPath.slice(1)

      if (relativePath.includes("\\") || relativePath.split("/").includes("..")) {
        response.writeHead(400).end()
        return
      }

      let filePath = path.join(dist, relativePath)
      let details
      try {
        details = await lstat(filePath)
        if (details.isDirectory() && requestPath.endsWith("/")) {
          const index = path.join(filePath, "index.html")
          const indexDetails = await lstat(index).catch((error) => {
            if (!["ENOENT", "ENOTDIR"].includes(error.code)) throw error
            return undefined
          })
          if (indexDetails?.isFile()) {
            filePath = index
            details = indexDetails
          }
        }
      } catch (error) {
        if (!["ENOENT", "ENOTDIR", "ENAMETOOLONG"].includes(error.code)) {
          throw error
        }
      }

      if (
        acceptsHtml &&
        ((!details && (!path.extname(relativePath) || templateNavigation)) ||
          (details?.isDirectory() && templateNavigation))
      ) {
        filePath = path.join(dist, "index.html")
        details = await lstat(filePath)
      }

      if (!details?.isFile()) {
        response.writeHead(404).end()
        return
      }

      response.writeHead(200, {
        "Content-Length": details.size,
        "Content-Type":
          CONTENT_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      })
      createReadStream(filePath).pipe(response)
    } catch (error) {
      const status = error.code === "ENOENT" || error.code === "ENOTDIR" ? 404 : 500
      response.writeHead(status).end()
    }
  })
}

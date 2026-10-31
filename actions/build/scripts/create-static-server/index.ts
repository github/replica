import { createReadStream } from "node:fs"
import { lstat } from "node:fs/promises"
import { createServer } from "node:http"
import path from "node:path"

import { CONTENT_TYPES } from "../constants.ts"

/** Serves checked dist files and falls back to the app entry for browser routes. */
export function createStaticServer(dist: string, templatePaths: string[] = []) {
  const templatePathnames = new Set(
    templatePaths.map((route) => decodeURIComponent(new URL(route, "http://localhost").pathname)),
  )

  return createServer(async (request, response) => {
    try {
      if (request.url === undefined) {
        response.writeHead(400).end()
        return
      }

      const requestPath = decodeURIComponent(new URL(request.url, "http://localhost").pathname)
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
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !("code" in error) ||
          typeof error.code !== "string" ||
          !["ENOENT", "ENOTDIR", "ENAMETOOLONG"].includes(error.code)
        ) {
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
      const status =
        error instanceof Error &&
        "code" in error &&
        (error.code === "ENOENT" || error.code === "ENOTDIR")
          ? 404
          : 500
      response.writeHead(status).end()
    }
  })
}

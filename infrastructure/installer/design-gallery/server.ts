import { randomBytes, timingSafeEqual } from "node:crypto"
import { createServer } from "node:http"
import type { IncomingMessage, ServerResponse } from "node:http"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { decodeCapture, writeDesignPack } from "./output.ts"
import type { Capture, RenderedScene } from "./types.ts"

class RequestError extends Error {
  readonly status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  if (request.headers["content-type"] !== "application/json") {
    throw new RequestError(415, "Export requests require application/json.")
  }
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of request) {
    length += chunk.length
    if (length > 12_000_000) throw new RequestError(413, "Capture request exceeds 12 MB.")
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"))
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    throw new RequestError(400, "Capture request is not valid JSON.")
  }
}

export async function startGallery({
  directory, scenes, revision,
}: {
  directory: string
  scenes: readonly RenderedScene[]
  revision: string
}) {
  const captures = new Map<string, Capture>()
  const ids = new Set(scenes.map(scene => scene.id))
  if (!ids.size || ids.size !== scenes.length ||
      scenes.some(scene => !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(scene.id))) {
    throw new Error("The capture server needs unique, safe semantic scene IDs.")
  }
  const token = randomBytes(32).toString("hex")
  let state: "capturing" | "finishing" | "complete" = "capturing"
  let url = ""
  const assets = new Map<string, [URL, string]>([
    ["/", [new URL("./capture.html", import.meta.url), "text/html"]],
    ["/assets/capture.js", [new URL("./capture.js", import.meta.url), "text/javascript"]],
    ["/assets/xterm.js", [new URL("../../node_modules/@xterm/xterm/lib/xterm.js", import.meta.url), "text/javascript"]],
    ["/assets/xterm.css", [new URL("../../node_modules/@xterm/xterm/css/xterm.css", import.meta.url), "text/css"]],
    ["/assets/html-to-image.js", [new URL("../../node_modules/html-to-image/dist/html-to-image.js", import.meta.url), "text/javascript"]],
  ])
  const outputs = new Map<string, [string, string]>([
    ["/gallery/index.html", ["index.html", "text/html"]],
    ["/gallery/manifest.json", ["manifest.json", "application/json"]],
    ["/gallery/Replica-wizard-design-guide.pdf", ["Replica-wizard-design-guide.pdf", "application/pdf"]],
  ])
  for (const scene of scenes) {
    for (const [extension, type] of [["png", "image/png"], ["txt", "text/plain"]]) {
      const path = `screens/${scene.id}.${extension}`
      outputs.set(`/gallery/${path}`, [path, type!])
    }
  }
  function json(response: ServerResponse, status: number, body: unknown) {
    response.writeHead(status, { "Content-Type": "application/json" })
    response.end(JSON.stringify(body))
  }
  async function handle(request: IncomingMessage, response: ServerResponse) {
    response.setHeader("Cache-Control", "no-store")
    response.setHeader("X-Content-Type-Options", "nosniff")
    response.setHeader("Cross-Origin-Resource-Policy", "same-origin")
    response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; frame-ancestors 'none'; base-uri 'none'")
    if (request.headers.host !== new URL(url).host) throw new RequestError(403, "Unknown request host.")
    const path = request.url ?? ""
    if (request.method === "GET") {
      if (path === "/scenes.json") return json(response, 200, { scenes, token })
      const asset = assets.get(path)
      if (asset) {
        response.writeHead(200, { "Content-Type": asset[1] })
        response.end(await readFile(fileURLToPath(asset[0])))
        return
      }
      const output = outputs.get(path)
      if (output && state === "complete") {
        response.writeHead(200, { "Content-Type": output[1] })
        response.end(await readFile(join(directory, output[0])))
        return
      }
      throw new RequestError(404, "Unknown gallery resource.")
    }
    if (request.method !== "POST") throw new RequestError(405, "Only GET and POST are supported.")
    const authorization = Buffer.from(request.headers.authorization ?? "")
    const expected = Buffer.from(`Bearer ${token}`)
    if (request.headers.origin !== url ||
        authorization.length !== expected.length || !timingSafeEqual(authorization, expected)) {
      throw new RequestError(403, "Export requires the capture page origin and session token.")
    }
    if (state !== "capturing") throw new RequestError(409, "This capture run is already finishing or complete.")
    if (path === "/finish") {
      if (captures.size !== scenes.length) {
        throw new RequestError(409, `Incomplete capture: ${captures.size} of ${scenes.length} screens.`)
      }
      state = "finishing"
      try {
        await writeDesignPack(directory, scenes, captures, revision)
        state = "complete"
      } catch (error) {
        state = "capturing"
        throw error
      }
      console.log(`Design pack complete: ${directory}`)
      return json(response, 200, {
        directory, gallery: "/gallery/index.html", pdf: "/gallery/Replica-wizard-design-guide.pdf",
      })
    }
    const id = path.startsWith("/capture/") ? path.slice("/capture/".length) : ""
    if (!ids.has(id)) throw new RequestError(404, "Unknown capture scene.")
    const payload = await readJson(request)
    let capture: Capture
    try {
      capture = await decodeCapture(payload)
    } catch (error) {
      throw new RequestError(400, error instanceof Error ? error.message : "Invalid capture.")
    }
    if (state !== "capturing") throw new RequestError(409, "Capture run is no longer accepting images.")
    captures.set(id, capture)
    json(response, 200, { captured: id, count: captures.size })
  }
  const server = createServer((request, response) => {
    void handle(request, response).catch(error => {
      const status = error instanceof RequestError ? error.status : 500
      const message = error instanceof Error ? error.message : "Unexpected capture server failure."
      if (status === 500) console.error(`Design export failed: ${message}`)
      if (!response.headersSent) json(response, status, { error: message })
      else response.destroy(error instanceof Error ? error : undefined)
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Capture server did not bind a loopback port.")
  url = `http://127.0.0.1:${address.port}`
  return {
    url, token,
    close: () => new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve())
      server.closeIdleConnections()
    }),
  }
}

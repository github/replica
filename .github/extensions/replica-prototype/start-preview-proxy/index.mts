import { lookup } from "node:dns/promises"
import { createServer, request as httpRequest } from "node:http"
import type {
  IncomingMessage,
  IncomingHttpHeaders,
  ServerResponse,
  ClientRequest,
  RequestOptions,
} from "node:http"
import { request as httpsRequest } from "node:https"
import type { Duplex } from "node:stream"
import { pipeline } from "node:stream/promises"
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib"
import { readHubError } from "../read-hub-error/index.mjs"

export type PreviewProxy = Awaited<ReturnType<typeof startPreviewProxy>>
export type PreviewProxyOptions = { prototypeUrl: string; parentOrigin: string; source: string }

const loaderPath = "/__replica/canvas/loader.js"
const runtimePath = "/__replica/canvas/runtime.js"
const hopHeaders = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]
const maxHtmlBytes = 8 * 1024 * 1024

/** Gives each local prototype preview its own unprivileged origin. */
export async function startPreviewProxy({
  prototypeUrl,
  parentOrigin,
  source,
}: PreviewProxyOptions) {
  const upstream = new URL(prototypeUrl)
  if (
    !["http:", "https:"].includes(upstream.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(upstream.hostname) ||
    upstream.username ||
    upstream.password ||
    upstream.origin === parentOrigin
  )
    throw new Error("Replica preview requires an unauthenticated loopback prototype URL.")
  const hostname = upstream.hostname.replace(/^\[|\]$/g, "")
  const addresses = await lookup(hostname, { all: true })
  if (
    !addresses.length ||
    addresses.some(({ address }) => address !== "127.0.0.1" && address !== "::1")
  )
    throw new Error("The prototype host must resolve only to loopback.")

  const sockets = new Set<Duplex>()
  const requests = new Set<ClientRequest>()
  let closing: Promise<void> | undefined
  const server = createServer((request, response) => {
    void forward(request, response).catch((caught: unknown) => {
      const error = readHubError(caught)
      if (response.destroyed) return
      if (response.headersSent) response.destroy(error)
      else {
        response.writeHead(typeof error.statusCode === "number" ? error.statusCode : 502, {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        })
        response.end(`Replica preview: ${error.message}`)
      }
    })
  })
  server.on("connection", trackSocket)
  server.on("upgrade", (request, socket, head) => {
    try {
      validateRequest(request)
      if (
        request.headers.origin !== origin ||
        request.headers.upgrade?.toLowerCase() !== "websocket"
      )
        throw requestError("Invalid preview WebSocket origin.")
      const target = upstreamRequest(request, true)
      target.on("error", () => socket.destroy())
      socket.once("close", () => target.destroy())
      target.on("response", (response) => {
        response.resume()
        socket.end(
          `HTTP/1.1 ${response.statusCode} WebSocket unavailable\r\nConnection: close\r\n\r\n`,
        )
      })
      target.on("upgrade", (response, upstreamSocket, upstreamHead) => {
        target.setTimeout(0)
        trackSocket(upstreamSocket)
        let headers
        try {
          headers = responseHeaders(response.headers)
        } catch {
          upstreamSocket.destroy()
          socket.end("HTTP/1.1 502 Preview unavailable\r\nConnection: close\r\n\r\n")
          return
        }
        headers.connection = "Upgrade"
        headers.upgrade = "websocket"
        socket.write(
          `HTTP/1.1 101 Switching Protocols\r\n${Object.entries(headers)
            .flatMap(([name, value]) =>
              (Array.isArray(value) ? value : [value]).map((entry) => `${name}: ${entry}\r\n`),
            )
            .join("")}\r\n`,
        )
        if (upstreamHead.length) socket.write(upstreamHead)
        if (head.length) upstreamSocket.write(head)
        socket.on("error", () => upstreamSocket.destroy())
        upstreamSocket.on("error", () => socket.destroy())
        socket.once("close", () => upstreamSocket.destroy())
        upstreamSocket.once("close", () => socket.destroy())
        socket.pipe(upstreamSocket).pipe(socket)
      })
      target.end()
    } catch (caught) {
      const error = readHubError(caught)
      socket.end(
        `HTTP/1.1 ${typeof error.statusCode === "number" ? error.statusCode : 502} Preview unavailable\r\nConnection: close\r\n\r\n`,
      )
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === "string") {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
    throw new Error("Replica preview server did not receive a loopback port.")
  }
  const origin = `http://127.0.0.1:${address.port}`

  function trackSocket(socket: Duplex) {
    sockets.add(socket)
    socket.on("error", () => socket.destroy())
    socket.once("close", () => sockets.delete(socket))
  }
  function validateRequest(request: IncomingMessage) {
    if (
      request.headers.host !== new URL(origin).host ||
      !request.url?.startsWith("/") ||
      request.url.startsWith("//") ||
      request.url.includes("\\") ||
      (request.method !== undefined && ["CONNECT", "TRACE"].includes(request.method)) ||
      request.headers["sec-fetch-site"] === "cross-site" ||
      (request.headers.origin && request.headers.origin !== origin)
    )
      throw requestError("Invalid preview request origin or target.")
    if (request.headers.authorization || request.headers["proxy-authorization"])
      throw requestError("Authenticated prototype previews are not supported.")
  }
  function upstreamRequest(request: IncomingMessage, websocket = false) {
    const headers = withoutHopHeaders(request.headers)
    // Port isolation does not isolate localhost cookies or canvas capabilities.
    for (const name of Object.keys(headers)) {
      if (
        name === "cookie" ||
        name.startsWith("x-replica-") ||
        name.startsWith("sec-fetch-") ||
        name.startsWith("x-forwarded-") ||
        name === "forwarded"
      )
        delete headers[name]
    }
    headers.host = upstream.host
    headers["accept-encoding"] = "identity"
    if (headers.origin) headers.origin = upstream.origin
    if (headers.referer) {
      const referer = new URL(headers.referer)
      if (referer.origin === origin)
        headers.referer = `${upstream.origin}${referer.pathname}${referer.search}`
      else delete headers.referer
    }
    if (websocket) {
      headers.connection = "Upgrade"
      headers.upgrade = "websocket"
    }
    const targetOptions: RequestOptions & { autoSelectFamily: boolean } = {
      protocol: upstream.protocol,
      hostname,
      port: upstream.port,
      method: request.method,
      path: request.url,
      headers,
      autoSelectFamily: true,
      lookup: (_host, options, callback) => {
        const first = addresses[0]
        if (!first) {
          callback(new Error("The prototype host must resolve only to loopback."), "", 4)
          return
        }
        if (options.all) callback(null, addresses)
        else callback(null, first.address, first.family)
      },
    }
    const target = (upstream.protocol === "https:" ? httpsRequest : httpRequest)(targetOptions)
    requests.add(target)
    target.once("close", () => requests.delete(target))
    target.setTimeout(30_000, () => target.destroy(new Error("The prototype server timed out.")))
    return target
  }
  function responseHeaders(original: IncomingHttpHeaders, requestUrl = upstream) {
    const headers = withoutHopHeaders(original)
    if (headers["set-cookie"] || headers["www-authenticate"])
      throw new Error("Authenticated prototype previews are not supported.")
    if (headers.location) {
      const destination = new URL(headers.location, requestUrl)
      if (destination.origin !== upstream.origin || destination.username || destination.password)
        throw new Error("The prototype redirected outside its selected origin.")
      headers.location = `${origin}${destination.pathname}${destination.search}${destination.hash}`
    }
    if (headers["access-control-allow-origin"] === upstream.origin)
      headers["access-control-allow-origin"] = origin
    return headers
  }
  async function forward(request: IncomingMessage, response: ServerResponse) {
    validateRequest(request)
    const url = new URL(request.url || "/", origin)
    if ([loaderPath, runtimePath].includes(url.pathname)) {
      if (
        request.method !== "GET" ||
        (url.pathname === runtimePath && url.searchParams.get("parent") !== parentOrigin)
      )
        throw requestError("Invalid preview bridge request.")
      response.writeHead(200, {
        "Content-Type": "text/javascript; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      })
      response.end(
        url.pathname === runtimePath
          ? source
          : `import { installBridge } from ${JSON.stringify(`${runtimePath}?parent=${encodeURIComponent(parentOrigin)}`)};\ninstallBridge(${JSON.stringify(parentOrigin)});\n`,
      )
      return
    }
    const target = upstreamRequest(request)
    response.once("close", () => target.destroy())
    request.once("aborted", () => target.destroy())
    let upstreamError: Error | undefined
    const received = new Promise<IncomingMessage>((resolve, reject) => {
      target.once("response", resolve)
      target.once("error", (error) => {
        upstreamError = error
        reject(error)
      })
    })
    request.pipe(target)
    const result = await received
    try {
      const headers = responseHeaders(result.headers, new URL(request.url || "/", upstream.origin))
      const html = /^text\/html(?:;|$)/i.test(headers["content-type"] || "")
      if (html && request.method !== "HEAD" && result.statusCode === 200) {
        if (
          /charset=/i.test(headers["content-type"] || "") &&
          !/charset=(?:"?utf-8"?|"?us-ascii"?)(?:;|$)/i.test(headers["content-type"] || "")
        )
          throw new Error("Preview HTML must use UTF-8.")
        let size = 0
        const chunks: Buffer[] = []
        const incoming: AsyncIterable<unknown> = result
        for await (const chunk of incoming) {
          if (!Buffer.isBuffer(chunk)) throw new Error("The prototype returned invalid HTML bytes.")
          size += chunk.length
          if (size > maxHtmlBytes) throw new Error("Preview HTML exceeds the 8 MiB limit.")
          chunks.push(chunk)
        }
        let body = Buffer.concat(chunks)
        const compression = headers["content-encoding"]
        const decompress = { gzip: gunzipSync, br: brotliDecompressSync, deflate: inflateSync }
        if (compression && compression !== "identity") {
          if (compression !== "gzip" && compression !== "br" && compression !== "deflate")
            throw new Error("Unsupported preview HTML compression.")
          body = decompress[compression](body, { maxOutputLength: maxHtmlBytes })
        }
        let text = new TextDecoder("utf-8", { fatal: true }).decode(body)
        // Module scripts run once per URL, including an existing adapter loader.
        text += `<script type="module" data-replica-canvas="1" src="${loaderPath}"></script>`
        for (const header of [
          "content-encoding",
          "content-length",
          "etag",
          "content-md5",
          "digest",
        ])
          delete headers[header]
        headers["cache-control"] = "no-store"
        // CSP and framing policies remain authoritative, even if they block the bridge.
        response.writeHead(200, headers)
        response.end(text)
      } else {
        target.setTimeout(0)
        if (result.statusCode === undefined)
          throw new Error("The prototype returned no HTTP status.")
        response.writeHead(result.statusCode, headers)
        await pipeline(result, response)
      }
    } catch (error) {
      // A closed response reports "aborted"; retain the upstream failure reason.
      throw upstreamError || error
    } finally {
      if (!result.readableEnded) result.destroy()
    }
  }
  const url = new URL(upstream)
  url.protocol = "http:"
  url.host = new URL(origin).host
  return {
    url: url.href,
    close() {
      if (closing) return closing
      for (const request of requests) request.destroy()
      for (const socket of sockets) socket.destroy()
      closing = new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
      return closing
    },
  }
}

function withoutHopHeaders(original: IncomingHttpHeaders): IncomingHttpHeaders {
  const headers = { ...original }
  for (const name of [
    ...hopHeaders,
    ...(original.connection || "").split(",").map((name) => name.trim().toLowerCase()),
  ])
    delete headers[name]
  return headers
}

function requestError(message: string) {
  return Object.assign(new Error(message), { statusCode: 403 })
}

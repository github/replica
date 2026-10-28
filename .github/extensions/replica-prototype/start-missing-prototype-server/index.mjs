import { randomBytes } from "node:crypto"
import { createServer } from "node:http"

import { renderMissingPrototypeHtml } from "../render-missing-prototype-html/index.mjs"
import {
  DESCRIPTION_ERROR,
  publicStartupError,
  publicStartupStatus,
  StartupError,
} from "../startup-error/index.mjs"

const SCAN_ERROR =
  "Could not check for servers. Check that lsof is installed and can inspect this checkout."
const CONNECT_ERROR =
  "Could not connect to that server. Make sure it is running, then try again or choose another server."
const DISCONNECTED_MESSAGE =
  "Prototype server unavailable. Start it again or choose another server."

export async function startMissingPrototypeServer({
  discover,
  connect,
  devServer,
  startupUnavailableMessage,
}) {
  const token = randomBytes(24).toString("base64url")
  const documentToken = randomBytes(32).toString("base64url")
  let scan
  let prototypeUrl = null
  let message = ""
  const server = createServer(async (request, response) => {
    if (request.headers.host !== `127.0.0.1:${request.socket.localPort}`) {
      send(response, 403, "Invalid canvas host.", "text/plain; charset=utf-8")
      return
    }
    let requestUrl
    try {
      requestUrl = new URL(request.url || "/", "http://127.0.0.1")
    } catch {
      send(response, 400, "Invalid canvas request URL.", "text/plain; charset=utf-8")
      return
    }
    if (request.method === "GET" && requestUrl.pathname === "/") {
      if (
        requestUrl.searchParams.getAll("document").length !== 1 ||
        requestUrl.searchParams.get("document") !== documentToken
      ) {
        send(response, 403, "Invalid canvas document token.", "text/plain; charset=utf-8")
        return
      }
      if (prototypeUrl) {
        response.writeHead(302, {
          Location: prototypeUrl,
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
        })
        response.end()
        return
      }
      send(response, 200, renderMissingPrototypeHtml(token), "text/html; charset=utf-8", token)
      return
    }
    if (request.headers["x-replica-canvas-token"] !== token) {
      send(response, 403, "Invalid canvas token.", "text/plain; charset=utf-8")
      return
    }
    if (request.method === "GET" && requestUrl.pathname === "/status") {
      send(
        response,
        200,
        JSON.stringify({
          prototypeUrl,
          message,
          ...(devServer ? { startup: publicStartupStatus(devServer.status()) } : {}),
        }),
        "application/json",
      )
      return
    }
    if (request.method === "POST" && requestUrl.pathname === "/start" && devServer) {
      try {
        const url = await devServer.start(requestUrl.searchParams.get("script"))
        try {
          await connect(url)
        } catch {
          throw new StartupError(CONNECT_ERROR)
        }
        send(response, 200, JSON.stringify({ prototypeUrl }), "application/json")
      } catch (error) {
        send(
          response,
          500,
          JSON.stringify({
            error: publicStartupError(error),
          }),
          "application/json",
        )
      }
      return
    }
    if (
      (request.method === "GET" && requestUrl.pathname === "/servers") ||
      (request.method === "POST" && requestUrl.pathname === "/connect")
    ) {
      let failureMessage = SCAN_ERROR
      try {
        scan ||= Promise.resolve()
          .then(discover)
          .finally(() => {
            scan = undefined
          })
        const result = await scan
        if (request.method === "POST") {
          const selected = result.servers.find(
            (candidate) => candidate.url === requestUrl.searchParams.get("url"),
          )
          if (!selected) {
            send(
              response,
              409,
              JSON.stringify({
                error: "This server is no longer available in this checkout. Try another server.",
              }),
              "application/json",
            )
            return
          }
          failureMessage = CONNECT_ERROR
          await connect(selected.url)
          send(response, 200, JSON.stringify({ prototypeUrl }), "application/json")
          return
        }
        send(
          response,
          200,
          JSON.stringify({
            servers: result.servers.map(({ url, command, pid }) => ({
              url,
              command,
              pid,
            })),
            warnings: result.warnings.map(publicWarning),
            ...(devServer
              ? {
                  development: await devServer.describe().catch((error) => ({
                    scripts: [],
                    message: publicStartupError(error, DESCRIPTION_ERROR),
                  })),
                }
              : startupUnavailableMessage
                ? {
                    development: {
                      scripts: [],
                      message: startupUnavailableMessage,
                    },
                  }
                : {}),
          }),
          "application/json",
        )
      } catch {
        send(response, 500, JSON.stringify({ error: failureMessage }), "application/json")
      }
      return
    }
    send(response, 404, "Not found.", "text/plain; charset=utf-8")
  })

  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject)
      resolve()
    })
  })

  const address = server.address()
  if (!address || typeof address === "string") {
    await closeServer(server)
    throw new Error("Replica prototype server did not receive a loopback port.")
  }

  return {
    url: `http://127.0.0.1:${address.port}/?document=${documentToken}`,
    async request(route, method = "GET") {
      const response = await fetch(`http://127.0.0.1:${address.port}${route}`, {
        method,
        headers: { "X-Replica-Canvas-Token": token },
        redirect: "error",
      })
      const result = await response.json()
      if (!response.ok)
        throw Object.assign(new Error(result.error || "The server request failed."), {
          statusCode: response.status,
        })
      return result
    },
    connect(url) {
      prototypeUrl = url
      message = ""
    },
    disconnect() {
      prototypeUrl = null
      message = DISCONNECTED_MESSAGE
    },
    close: () => closeServer(server),
  }
}

function publicWarning(warning) {
  // Discovery warnings can contain fetch errors; keep only the loopback URL and HTTP status.
  const match =
    typeof warning === "string" &&
    /^(http:\/\/(?:127(?:\.\d+){3}|\[::1\]):\d+\/) (?:did not return an HTML page \(HTTP (\d{3})\)\.|could not be checked:[\s\S]*)$/.exec(
      warning,
    )
  if (!match) return "A server could not be checked. Make sure it is running and serves HTML."
  if (match[2]) return `${match[1]} did not return an HTML page (HTTP ${match[2]}).`
  return `${match[1]} could not be checked. Make sure it is running.`
}

function send(response, status, body, contentType, nonce) {
  response.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce || ""}'; connect-src 'self'; base-uri 'none'; form-action 'none'`,
  })
  response.end(body)
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}

import { randomBytes } from "node:crypto"
import { createServer } from "node:http"
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
  const server = createServer((request, response) => {
    void serve(request, response)
  })
  async function serve(request, response) {
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
        const script = requestUrl.searchParams.get("script")
        if (script === null)
          throw new StartupError(
            "Dev scripts changed or are unavailable. Wait for the server list to refresh before starting.",
          )
        const url = await devServer.start(script)
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
                error:
                  "This server is no longer available in this checkout. The server list will refresh automatically.",
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
            servers: result.servers.map(({ url, command, pid }) => ({ url, command, pid })),
            warnings: result.warnings.map(publicWarning),
            ...(devServer
              ? {
                  development: await devServer.describe().catch((error) => ({
                    scripts: [],
                    message: publicStartupError(error, DESCRIPTION_ERROR),
                  })),
                }
              : startupUnavailableMessage
                ? { development: { scripts: [], message: startupUnavailableMessage } }
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
  }
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
        throw Object.assign(
          new Error(
            result &&
              typeof result === "object" &&
              "error" in result &&
              typeof result.error === "string"
              ? result.error
              : "The server request failed.",
          ),
          { statusCode: response.status },
        )
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
function renderMissingPrototypeHtml(token) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Replica prototype</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      background: var(--background-color-default, Canvas);
      color: var(--text-color-default, CanvasText);
    }
    body {
      min-height: 100vh;
      margin: 0;
      display: grid;
      place-items: center;
      background: inherit;
      color: inherit;
    }
    main {
      width: min(36rem, calc(100% - 3rem));
      text-align: center;
    }
    h1 {
      margin: 0;
      font-size: var(--text-title-large, 1.625rem);
      line-height: var(--leading-title-large, 2rem);
      font-weight: var(--font-weight-semibold, 600);
    }
    p {
      margin: 0.75rem 0 0;
      color: var(--text-color-muted, GrayText);
      font-size: var(--text-body-medium, 0.875rem);
      line-height: var(--leading-body-medium, 1.25rem);
    }
    button {
      margin-block-start: 1.5rem;
      padding: 0.625rem 1rem;
      border: 1px solid var(--border-color-default, GrayText);
      border-radius: 0.375rem;
      background: var(--background-color-default, Canvas);
      color: inherit;
      font: inherit;
      cursor: pointer;
    }
    button:focus-visible {
      outline: 2px solid var(--color-focus-outline, Highlight);
      outline-offset: 2px;
    }
    button:disabled { cursor: default; opacity: 0.6; }
    .actions { display: flex; justify-content: center; gap: 0.75rem; }
    #start {
      background: var(--true-color-blue, #0969da);
      color: var(--color-white, #ffffff);
      border-color: transparent;
    }
    select { max-width: 100%; margin-block-start: 1rem; padding: 0.5rem; font: inherit; }
    pre { max-height: 12rem; overflow: auto; text-align: start; white-space: pre-wrap; overflow-wrap: anywhere; }
    [hidden] { display: none !important; }
    ul { list-style: none; padding: 0; }
    p:empty, ul:empty { display: none; }
    li {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 1rem;
      margin-block-start: 1rem;
    }
    li p { margin: 0; min-width: 0; overflow-wrap: anywhere; text-align: start; }
    li button { margin: 0; flex-shrink: 0; }
    #warnings { white-space: pre-line; }
  </style>
</head>
<body>
  <main>
    <h1>Open your prototype</h1>
    <p id="status" role="status" aria-live="polite">Checking this checkout for running servers...</p>
    <div class="actions">
      <button type="button" id="start" hidden>Start dev server</button>
      <button type="button" id="scan">Scan again</button>
    </div>
    <select id="scripts" aria-label="Dev server script" hidden></select>
    <p id="consent" hidden></p>
    <pre id="output" aria-label="Dev server output" hidden></pre>
    <ul id="servers" aria-label="Running servers"></ul>
    <p id="warnings"></p>
  </main>
  <script nonce="${token}">
    const button = document.querySelector("#scan")
    const status = document.querySelector("#status")
    const list = document.querySelector("#servers")
    const warnings = document.querySelector("#warnings")
    const startButton = document.querySelector("#start")
    const scripts = document.querySelector("#scripts")
    const consent = document.querySelector("#consent")
    const output = document.querySelector("#output")
    let development = []
    let starting = false
    let scanning = false
    const headers = { "X-Replica-Canvas-Token": "${token}" }
    async function readResponse(response) {
      if (!response.ok) {
        const body = await response.text()
        let message = body
        try { message = JSON.parse(body).error || body } catch {}
        throw new Error(message || "The canvas request failed.")
      }
      return response.json()
    }
    async function scanServers() {
      if (starting || scanning) return
      scanning = true
      button.disabled = true
      if (startButton) startButton.disabled = true
      if (scripts) scripts.disabled = true
      list.replaceChildren()
      warnings.textContent = ""
      status.textContent = "Checking this checkout for running servers..."
      try {
        const result = await readResponse(await fetch("/servers", { headers }))
        status.textContent = result.servers.length
          ? "Choose a server to connect."
          : "No running servers found. Start your development server, then scan again."
        warnings.textContent = result.warnings.join("\\n")
        development = result.development?.scripts || []
        if (!result.servers.length && development.length) {
          status.textContent = "No running servers found. Start your prototype here."
        }
        if (startButton) {
          startButton.hidden = result.servers.length > 0 || development.length === 0
          scripts.hidden = startButton.hidden || development.length < 2
          scripts.replaceChildren()
          for (const script of development) {
            const option = document.createElement("option")
            option.value = script.id
            option.textContent = script.invocation
            scripts.append(option)
          }
          scripts.value = development[0]?.id || ""
          consent.hidden = !result.development || result.servers.length > 0
          consent.textContent = result.development?.message || ""
        }
        for (const server of result.servers) {
          const item = document.createElement("li")
          const label = document.createElement("p")
          const displayUrl = new URL(server.url)
          if (displayUrl.hostname === "[::1]" || displayUrl.hostname === "127.0.0.1") {
            displayUrl.hostname = "localhost"
          }
          label.textContent = displayUrl.href + " — " + server.command + " (PID " + server.pid + ")"
          label.title = server.url
          const select = document.createElement("button")
          select.type = "button"
          select.textContent = "Connect"
          select.setAttribute("aria-label", "Connect to " + displayUrl.href)
          select.addEventListener("click", async () => {
            select.disabled = true
            status.textContent = "Connecting..."
            try {
              const result = await readResponse(await fetch("/connect?url=" + encodeURIComponent(server.url), { method: "POST", headers }))
              window.location.replace(result.prototypeUrl)
            } catch (error) {
              status.textContent = error.message
              select.disabled = false
            }
          })
          item.append(label, select)
          list.append(item)
        }
      } catch (error) {
        status.textContent = error.message
        if (startButton) {
          startButton.hidden = true
          scripts.hidden = true
          consent.hidden = true
        }
      } finally {
        scanning = false
        button.disabled = starting
        if (startButton) startButton.disabled = starting
        if (scripts) scripts.disabled = starting
      }
    }
    button.addEventListener("click", scanServers)
    startButton?.addEventListener("click", async () => {
      if (starting || scanning) return
      starting = true
      startButton.disabled = true
      button.disabled = true
      scripts.disabled = true
      status.textContent = "Starting your prototype..."
      try {
        const result = await readResponse(await fetch("/start?script=" + encodeURIComponent(scripts.value), {
          method: "POST", headers,
        }))
        window.location.replace(result.prototypeUrl)
      } catch (error) {
        status.textContent = error.message
      } finally {
        starting = false
        startButton.disabled = false
        button.disabled = false
        scripts.disabled = false
      }
    })
    async function refresh() {
      try {
        const state = await readResponse(await fetch("/status", { headers }))
        if (state.prototypeUrl) {
          window.location.replace(state.prototypeUrl)
          return
        }
        if (state.startup && output) {
          output.textContent = state.startup.output
          output.hidden = !state.startup.output
          if (state.startup.starting) status.textContent = state.startup.message || "Starting your prototype..."
        }
      } catch (error) {
        status.textContent = "Could not check prototype status: " + error.message
      }
      setTimeout(refresh, 1000)
    }
    refresh()
    scanServers()
  </script>
</body>
</html>`
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

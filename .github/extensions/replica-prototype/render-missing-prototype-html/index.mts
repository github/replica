export function renderMissingPrototypeHtml(token: string): string {
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

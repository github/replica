export function renderCanvasHtml(context, token, setupUrl) {
  const bootstrap = JSON.stringify({
    prototypeUrl: context.normalizedUrl,
    previewUrl: context.previewUrl,
    name: context.name,
    token,
    pickAndPolish: true,
    ...(context.improvementNotesDemo ? { improvementNotesDemo: true } : {}),
  }).replaceAll("<", "\\u003c")

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(context.name)} · Replica</title>
  <link rel="stylesheet" href="/assets/renderer.css">
</head>
<body class="renderer-loading">
  <div id="root"></div>
  <script>window.__REPLICA_CANVAS__ = ${bootstrap};</script>
  <script type="module" src="/assets/renderer.js"></script>
  ${
    setupUrl
      ? `<p id="prototype-connection-error" role="alert"></p>
  <script>
    const setupUrl = ${JSON.stringify(setupUrl).replaceAll("<", "\\u003c")}
    async function checkPrototype() {
      try {
        const response = await fetch("/api/prototype/status", {
          headers: { "X-Replica-Canvas-Token": window.__REPLICA_CANVAS__.token },
        })
        const status = await response.json()
        if (!response.ok) throw new Error(status.error || "Could not check the prototype server.")
        if (!status.available) {
          window.location.replace(setupUrl)
          return
        }
        document.querySelector("#prototype-connection-error").textContent = ""
      } catch (error) {
        document.querySelector("#prototype-connection-error").textContent = error.message
      }
      setTimeout(checkPrototype, 5000)
    }
    checkPrototype()
  </script>`
      : ""
  }
</body>
</html>`
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

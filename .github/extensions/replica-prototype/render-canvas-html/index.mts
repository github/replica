import type { CanvasContext } from "../create-canvas-context/index.mjs"

export function renderCanvasHtml(
  context: Pick<CanvasContext, "normalizedUrl" | "name" | "improvementThreadsSample"> & {
    previewUrl?: string
    monitorPrototype?: boolean
  },
  token: string,
) {
  const bootstrap = JSON.stringify({
    prototypeUrl: context.normalizedUrl,
    previewUrl: context.previewUrl,
    name: context.name,
    token,
    monitorPrototype: context.monitorPrototype === true,
    pickAndPolish: true,
    ...(context.improvementThreadsSample ? { improvementThreadsSample: true } : {}),
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
</body>
</html>`
}

function escapeHtml(value: unknown) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

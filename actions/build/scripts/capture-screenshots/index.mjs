import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { createServer, request } from "node:http"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { chromium } from "playwright"

import { closeServer } from "../close-server/index.mjs"
import { MAX_SCREENSHOT_HEIGHT, START_ROUTE, VIEWPORTS } from "../constants.mjs"
import { createStaticServer } from "../create-static-server/index.mjs"
import { listenOnLoopback } from "../listen-on-loopback/index.mjs"
import { readTemplates } from "../read-templates/index.mjs"
import { requiredPathArgument } from "../required-path-argument/index.mjs"
import { validateBuildOutput } from "../validate-build-output/index.mjs"
import { normalizeBasePath } from "../normalize-base-path/index.mjs"

async function createCaptureProxy(allowedOrigin) {
  const proxy = createServer((incoming, response) => {
    let target
    try {
      target = new URL(incoming.url)
    } catch {
      response.writeHead(400).end()
      return
    }
    if (target.origin !== allowedOrigin) {
      response.writeHead(403).end()
      return
    }
    const outgoing = request(target, {
      method: incoming.method,
      headers: { ...incoming.headers, host: target.host },
    })
    outgoing.on("response", (upstream) => {
      response.writeHead(upstream.statusCode ?? 502, upstream.headers)
      upstream.pipe(response)
    })
    outgoing.on("error", () => response.writeHead(502).end())
    incoming.pipe(outgoing)
  })
  proxy.on("connect", (_request, socket) => socket.destroy())
  proxy.on("upgrade", (_request, socket) => socket.destroy())
  const port = await listenOnLoopback(proxy)
  return { proxy, address: `http://127.0.0.1:${port}` }
}

/** Captures the root and declared templates in both color schemes at each width. */
export async function captureScreenshots(
  root,
  screenshots,
  configRoot = root,
  configFile = ".github/replica.json",
  basePath = "/",
) {
  const base = normalizeBasePath(basePath)
  await validateBuildOutput(root)
  const manifest = await readTemplates(configRoot, configFile)
  const controlsAdapter = await readFile(
    new URL("../../../../hub/client/utils/prototype-controls/browser.js", import.meta.url),
    "utf8",
  )
  await rm(screenshots, { force: true, recursive: true })
  await mkdir(screenshots, { recursive: true })

  const server = createStaticServer(
    path.join(root, "dist"),
    manifest?.templates.map((template) => template.path),
    base,
  )
  const port = await listenOnLoopback(server)
  const allowedOrigin = `http://127.0.0.1:${port}`
  const captureProxy = await createCaptureProxy(allowedOrigin)
  let browser

  try {
    browser = await chromium.launch({
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
      proxy: { server: captureProxy.address },
      args: ["--proxy-bypass-list=<-loopback>"],
    })
    const adapterUrl = `${allowedOrigin}${base}__replica/capture-controls.js`

    const destinations = [
      { path: START_ROUTE, directory: "" },
      ...(manifest?.templates.map((template) => ({
        path: template.path,
        directory: `templates/${template.id}`,
      })) ?? []),
    ]

    for (const destination of destinations) {
      await mkdir(path.join(screenshots, destination.directory), { recursive: true })
      for (const viewport of VIEWPORTS) {
        for (const colorScheme of ["light", "dark"]) {
          const context = await browser.newContext({ viewport, colorScheme })
          await context.routeWebSocket(/.*/, (socket) => socket.close())
          const page = await context.newPage()
          await page.addInitScript(() => {
            globalThis.WebSocket = class {
              constructor() {
                throw new Error("WebSocket connections are disabled during screenshot capture.")
              }
            }
          })
          await context.route("**/*", async (route) => {
            const requestUrl = new URL(route.request().url())

            if (requestUrl.href === adapterUrl) {
              await route.fulfill({
                contentType: "text/javascript",
                body: controlsAdapter,
              })
            } else if (requestUrl.origin === allowedOrigin) {
              await route.continue()
            } else {
              await route.abort("blockedbyclient")
            }
          })

          let address = `${allowedOrigin}${base}${destination.path.slice(1)}`
          for (let attempt = 0; ; attempt++) {
            if (attempt === 4)
              throw new Error("Controls URL defaults did not settle after navigation.")
            let response = await page.goto(address, { waitUntil: "networkidle" })
            // Fragment-only navigation does not reboot the app or clear the adapter.
            if (!response && new URL(page.url()).origin === allowedOrigin)
              response = await page.reload({ waitUntil: "networkidle" })
            if (!response?.ok() || new URL(page.url()).origin !== allowedOrigin)
              throw new Error(
                `Screenshot route ${destination.path} did not load a local successful page.`,
              )
            await page.evaluate(() => document.fonts.ready)
            await page.addScriptTag({ url: adapterUrl })
            const navigation = await page.evaluate(async () => {
              const bindings = await globalThis.ReplicaControls.ready
              return bindings?.takeNavigation()
            })
            if (!navigation) break
            if (
              new URL(navigation).origin !== allowedOrigin ||
              !new URL(navigation).pathname.startsWith(base)
            )
              throw new Error("Controls URL defaults cannot leave the retained Build.")
            address = navigation
          }
          const height = await page.evaluate(() =>
            Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
          )
          const name = path.posix.join(
            destination.directory,
            `${viewport.name}${colorScheme === "dark" ? "-dark" : ""}.png`,
          )
          if (height > MAX_SCREENSHOT_HEIGHT) {
            throw new Error(
              `Screenshot ${name} exceeds the maximum height of ${MAX_SCREENSHOT_HEIGHT} pixels; found ${height}.`,
            )
          }

          await page.screenshot({
            path: path.join(screenshots, name),
            fullPage: true,
            clip: { x: 0, y: 0, width: viewport.width, height: Math.max(viewport.height, height) },
          })
          await context.close()
        }
      }
    }
    if (manifest) {
      await writeFile(path.join(screenshots, "templates.json"), JSON.stringify(manifest))
    }
  } finally {
    await browser?.close()
    await closeServer(captureProxy.proxy)
    await closeServer(server)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await captureScreenshots(
    requiredPathArgument("root"),
    requiredPathArgument("screenshots"),
    process.argv.includes("--config-root") ? requiredPathArgument("config-root") : undefined,
    process.argv.includes("--config-file")
      ? requiredPathArgument("config-file", { resolve: false })
      : undefined,
    process.argv.includes("--base-path")
      ? requiredPathArgument("base-path", { resolve: false })
      : undefined,
  )
  console.log(
    "Captured light and dark desktop and narrow screenshots for the root page and declared templates.",
  )
}

import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { chromium, type Browser } from "playwright"

import { closeServer } from "../close-server/index.ts"
import { MAX_SCREENSHOT_HEIGHT, START_ROUTE, VIEWPORTS } from "../constants.ts"
import { createStaticServer } from "../create-static-server/index.ts"
import { listenOnLoopback } from "../listen-on-loopback/index.ts"
import { readTemplates } from "../read-templates/index.ts"
import { requiredPathArgument } from "../required-path-argument/index.ts"
import { validateBuildOutput } from "../validate-build-output/index.ts"

declare global {
  var ReplicaControls: {
    ready: Promise<{ takeNavigation(): string | undefined } | undefined>
  }
}

/** Captures the root and declared templates in both color schemes at each width. */
export async function captureScreenshots(root: string, screenshots: string, configRoot = root) {
  await validateBuildOutput(root)
  const manifest = await readTemplates(configRoot)
  const controlsAdapter = await readFile(
    new URL("../../../../hub/app/javascript/utils/prototype-controls/browser.js", import.meta.url),
    "utf8",
  )
  await rm(screenshots, { force: true, recursive: true })
  await mkdir(screenshots, { recursive: true })

  const server = createStaticServer(
    path.join(root, "dist"),
    manifest?.templates.map((template) => template.path),
  )
  const port = await listenOnLoopback(server)
  let browser: Browser | undefined

  try {
    browser = await chromium.launch({
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    })
    const allowedOrigin = `http://127.0.0.1:${port}`
    const adapterUrl = `${allowedOrigin}/__replica/capture-controls.js`

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
        for (const colorScheme of ["light", "dark"] as const) {
          const context = await browser.newContext({ viewport, colorScheme })
          const page = await context.newPage()
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

          let address = `${allowedOrigin}${destination.path}`
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
            if (new URL(navigation).origin !== allowedOrigin)
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
    await closeServer(server)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await captureScreenshots(
    requiredPathArgument("root"),
    requiredPathArgument("screenshots"),
    process.argv.includes("--config-root") ? requiredPathArgument("config-root") : undefined,
  )
  console.log(
    "Captured light and dark desktop and narrow screenshots for the root page and declared templates.",
  )
}

import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

import { format, resolveConfig } from "prettier"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import ts from "typescript"
import { chromium } from "../../actions/build/node_modules/playwright/index.mjs"

const root = resolve(import.meta.dirname, "..")
const formatting = await resolveConfig(resolve(root, "script/build-template-story-fixtures.mjs"))
const scratch = resolve(root, ".storybook/template-fixture-build")
const output = resolve(root, ".storybook/preview-fixtures/templates")
await mkdir(scratch, { recursive: true })
await mkdir(output, { recursive: true })
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"],
})

try {
  for (const id of ["default", "welcome", "field-notes", "signal-room"]) {
    const sourcePath =
      id === "default"
        ? "../starters/minimal/src/routes/home/home-page/index.tsx"
        : `db/seeds/local/example/${id}.tsx`
    const source = await readFile(resolve(root, sourcePath), "utf8")
    const css =
      id === "default"
        ? "body{font-family:system-ui;color:#1f2328}main{padding:1rem}a{color:#0969da}"
        : await readFile(resolve(root, `db/seeds/local/example/${id}.css`), "utf8")
    const javascript = ts.transpileModule(source.replace('import "./styles.css"', ""), {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
    }).outputText
    const modulePath = resolve(scratch, `${id}.mjs`)
    await writeFile(modulePath, javascript)
    const { HomePage } = await import(pathToFileURL(modulePath).href)
    const markup = renderToStaticMarkup(
      createElement(HomePage, {
        aboutLink: createElement("a", { href: "#/about" }, "Go to the about page"),
      }),
    )
    const html = await format(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${id}</title><style>body{margin:0}*{box-sizing:border-box}${css}</style></head><body>${markup}</body></html>`,
      { ...formatting, parser: "html" },
    )
    await writeFile(resolve(output, `${id}.html`), html)
    const page = await browser.newPage({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
    })
    await page.setContent(html, { waitUntil: "networkidle" })
    await page.screenshot({ path: resolve(output, `${id}.png`), fullPage: true })
    await page.close()
  }
} finally {
  await browser.close()
  await rm(scratch, { recursive: true, force: true })
}

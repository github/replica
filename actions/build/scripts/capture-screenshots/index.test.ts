import assert from "node:assert/strict"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, it } from "node:test"

import pngjs from "pngjs"

import { temporaryDirectory } from "../../test/temporary-directory/index.ts"

import { createPackage } from "../create-package/index.ts"
import { MAX_SCREENSHOT_HEIGHT } from "../constants.ts"

import { captureScreenshots } from "./index.ts"

describe("captureScreenshots()", () => {
  it("captures and packages both color schemes at both widths for the root and templates", async () => {
    const root = await temporaryDirectory()
    const screenshots = await temporaryDirectory()
    const output = path.join(await temporaryDirectory(), "package")
    await mkdir(path.join(root, "dist"))
    await mkdir(path.join(root, ".github"))
    await writeFile(
      path.join(root, "dist/index.html"),
      '<!doctype html><html><head><style>html,body{margin:0;background:white}main{height:1000px}@media(prefers-color-scheme:dark){html,body{background:black}main{height:1200px}}</style></head><body><main></main><script>if(location.pathname==="/settings")document.body.style.background=matchMedia("(prefers-color-scheme:dark)").matches?"blue":"red"</script></body></html>',
    )
    await writeFile(
      path.join(root, ".github/replica.json"),
      JSON.stringify({
        version: 1,
        templates: [
          {
            id: "settings",
            name: "Settings",
            category: "Configuration",
            description: "Edit settings.",
            path: "/settings",
          },
        ],
      }),
    )

    await captureScreenshots(root, screenshots)
    await createPackage(root, screenshots, output)

    for (const directory of ["", "templates/settings"]) {
      for (const [name, width] of [
        ["desktop", 1440],
        ["narrow", 390],
      ]) {
        for (const [suffix, height, color] of [
          ["", 1000, [255, 255, 255]],
          ["-dark", 1200, [0, 0, 0]],
        ]) {
          const filename = path.join(directory, `${name}${suffix}.png`)
          const captured = await readFile(path.join(screenshots, filename))
          const packaged = await readFile(path.join(output, "screenshots", filename))
          assert.deepEqual(packaged, captured)
          const image = pngjs.PNG.sync.read(packaged)
          assert.deepEqual([image.width, image.height], [width, height])
          const expectedColor = directory ? (suffix ? [0, 0, 255] : [255, 0, 0]) : color
          assert.deepEqual([...image.data.subarray(0, 3)], expectedColor)
        }
      }
    }
  })

  it("applies Controls defaults under a same-origin script policy", async () => {
    const root = await temporaryDirectory()
    const screenshots = await temporaryDirectory()
    await mkdir(path.join(root, "dist"))
    await writeFile(
      path.join(root, "dist", "index.html"),
      '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="script-src \'self\'"></head><body style="margin:0;background:blue"><input id="accent" type="color" value="#0000ff"><script src="/app.js"></script></body></html>',
    )
    await writeFile(
      path.join(root, "dist", "app.js"),
      'document.querySelector("input").addEventListener("input",event=>document.body.style.background=event.target.value)',
    )
    await writeFile(
      path.join(root, "dist", "controls.replica.json"),
      JSON.stringify({
        version: 1,
        scope: "page",
        controls: [
          {
            id: "accent",
            label: "Accent",
            type: "color",
            default: "#ff0000",
            binding: { type: "field", selector: "#accent" },
          },
        ],
      }),
    )
    await captureScreenshots(root, screenshots)
    for (const name of ["desktop", "narrow", "desktop-dark", "narrow-dark"]) {
      const image = pngjs.PNG.sync.read(await readFile(path.join(screenshots, `${name}.png`)))
      const bottom = (image.height - 1) * image.width * 4
      assert.deepEqual([...image.data.subarray(bottom, bottom + 3)], [255, 0, 0])
    }
  })
  it("captures an app without Controls under a same-origin script policy", async () => {
    const root = await temporaryDirectory()
    const screenshots = await temporaryDirectory()
    await mkdir(path.join(root, "dist"))
    await writeFile(
      path.join(root, "dist", "index.html"),
      '<!doctype html><html lang="en"><head><meta http-equiv="Content-Security-Policy" content="script-src \'self\'"><title>Fixture</title></head><body><main><h1>Replica</h1></main></body></html>',
    )

    await captureScreenshots(root, screenshots)

    const desktop = await readFile(path.join(screenshots, "desktop.png"))
    const narrow = await readFile(path.join(screenshots, "narrow.png"))
    assert.deepEqual([desktop.readUInt32BE(16), desktop.readUInt32BE(20)], [1440, 900])
    assert.deepEqual([narrow.readUInt32BE(16), narrow.readUInt32BE(20)], [390, 844])
  })

  it("navigates before capture when app boot reads a URL-bound default", async () => {
    const root = await temporaryDirectory()
    const screenshots = await temporaryDirectory()
    await mkdir(path.join(root, "dist"))
    await writeFile(
      path.join(root, "dist", "index.html"),
      '<!doctype html><body style="margin:0"><script>document.body.style.background=new URLSearchParams(location.search).get("view")==="red"?"red":"blue"</script></body>',
    )
    await writeFile(
      path.join(root, "dist", "controls.replica.json"),
      JSON.stringify({
        version: 1,
        scope: "page",
        controls: [
          {
            id: "view",
            label: "View",
            type: "select",
            default: "red",
            options: ["red", "blue"],
            binding: { type: "query", key: "view", mode: "navigate" },
          },
        ],
      }),
    )
    await captureScreenshots(root, screenshots)
    for (const name of ["desktop", "narrow", "desktop-dark", "narrow-dark"]) {
      const image = pngjs.PNG.sync.read(await readFile(path.join(screenshots, `${name}.png`)))
      const bottom = (image.height - 1) * image.width * 4
      assert.deepEqual([...image.data.subarray(bottom, bottom + 3)], [255, 0, 0])
    }
  })

  it("reloads before capture when app boot reads a hash navigation default", async () => {
    const root = await temporaryDirectory()
    const screenshots = await temporaryDirectory()
    await mkdir(path.join(root, "dist"))
    await writeFile(
      path.join(root, "dist", "index.html"),
      '<!doctype html><body style="margin:0"><script>document.body.style.background=location.hash==="#red"?"red":"blue"</script></body>',
    )
    await writeFile(
      path.join(root, "dist", "controls.replica.json"),
      JSON.stringify({
        version: 1,
        scope: "page",
        controls: [
          {
            id: "view",
            label: "View",
            type: "select",
            default: "red",
            options: ["red", "blue"],
            binding: { type: "hash", mode: "navigate" },
          },
        ],
      }),
    )
    await captureScreenshots(root, screenshots)
    for (const name of ["desktop", "narrow", "desktop-dark", "narrow-dark"]) {
      const image = pngjs.PNG.sync.read(await readFile(path.join(screenshots, `${name}.png`)))
      const bottom = (image.height - 1) * image.width * 4
      assert.deepEqual([...image.data.subarray(bottom, bottom + 3)], [255, 0, 0])
    }
  })

  it("captures an offscreen action without running it", async () => {
    const root = await temporaryDirectory()
    const screenshots = await temporaryDirectory()
    await mkdir(path.join(root, "dist"))
    await writeFile(
      path.join(root, "dist", "index.html"),
      '<!doctype html><body style="margin:0;background:red"><button id="action" style="position:absolute;top:2000px" onclick="document.body.style.background=\'blue\'">Change color</button></body>',
    )
    await writeFile(
      path.join(root, "dist", "controls.replica.json"),
      JSON.stringify({
        version: 1,
        scope: "page",
        controls: [
          {
            id: "action",
            label: "Change color",
            type: "button",
            binding: { type: "button", selector: "#action" },
          },
        ],
      }),
    )
    await captureScreenshots(root, screenshots)
    for (const name of ["desktop", "narrow"]) {
      const image = pngjs.PNG.sync.read(await readFile(path.join(screenshots, `${name}.png`)))
      assert.deepEqual([...image.data.subarray(0, 3)], [255, 0, 0])
    }
  })

  it("rejects a value default that cannot reach its app target", async () => {
    const root = await temporaryDirectory()
    const screenshots = await temporaryDirectory()
    await mkdir(path.join(root, "dist"))
    await writeFile(path.join(root, "dist", "index.html"), "<!doctype html><body>App</body>")
    await writeFile(
      path.join(root, "dist", "controls.replica.json"),
      JSON.stringify({
        version: 1,
        scope: "page",
        controls: [
          {
            id: "title",
            label: "Title",
            type: "text",
            default: "Default",
            binding: { type: "field", selector: "#missing" },
          },
        ],
      }),
    )
    await assert.rejects(
      captureScreenshots(root, screenshots),
      /Controls defaults could not be applied: page.title: The binding target is missing/,
    )
    await assert.rejects(readFile(path.join(screenshots, "desktop.png")), { code: "ENOENT" })
  })

  it("captures the bottom of a tall, wide page at both widths and packages the results", async () => {
    const root = await temporaryDirectory()
    const screenshots = await temporaryDirectory()
    const output = path.join(await temporaryDirectory(), "package")
    await mkdir(path.join(root, "dist"))
    await writeFile(
      path.join(root, "dist", "index.html"),
      '<!doctype html><html lang="en"><head><title>Fixture</title><style>html,body{margin:0}main{width:2200px;height:1800px;background:white}footer{height:100px;background:red}</style></head><body><main>Start</main><footer>End</footer></body></html>',
    )

    await captureScreenshots(root, screenshots)
    await createPackage(root, screenshots, output)

    for (const [name, width] of [
      ["desktop", 1440],
      ["narrow", 390],
    ]) {
      const screenshot = pngjs.PNG.sync.read(
        await readFile(path.join(output, "screenshots", `${name}.png`)),
      )
      assert.deepEqual([screenshot.width, screenshot.height], [width, 1900])
      const bottom = (screenshot.height - 1) * screenshot.width * 4
      assert.deepEqual([...screenshot.data.subarray(bottom, bottom + 3)], [255, 0, 0])
    }
  })

  it("rejects a dark page taller than the package limit even when its light capture fits", async () => {
    const root = await temporaryDirectory()
    const screenshots = await temporaryDirectory()
    await mkdir(path.join(root, "dist"))
    await writeFile(
      path.join(root, "dist/index.html"),
      `<!doctype html><html><head><style>body{margin:0}main{height:1000px}@media(prefers-color-scheme:dark){main{height:${MAX_SCREENSHOT_HEIGHT + 1}px}}</style></head><body><main></main></body></html>`,
    )

    await assert.rejects(
      captureScreenshots(root, screenshots),
      new Error(
        `Screenshot desktop-dark.png exceeds the maximum height of ${MAX_SCREENSHOT_HEIGHT} pixels; found ${MAX_SCREENSHOT_HEIGHT + 1}.`,
      ),
    )
    assert.equal((await readFile(path.join(screenshots, "desktop.png"))).readUInt32BE(20), 1000)
    await assert.rejects(readFile(path.join(screenshots, "desktop-dark.png")), { code: "ENOENT" })
  })

  it("rejects a page taller than the package limit before capturing it", async () => {
    const root = await temporaryDirectory()
    const screenshots = await temporaryDirectory()
    await mkdir(path.join(root, "dist"))
    await writeFile(
      path.join(root, "dist", "index.html"),
      `<!doctype html><html lang="en"><head><title>Fixture</title><style>body{margin:0}main{height:${MAX_SCREENSHOT_HEIGHT + 1}px}</style></head><body><main>Too tall</main></body></html>`,
    )

    await assert.rejects(
      captureScreenshots(root, screenshots),
      new Error(
        `Screenshot desktop.png exceeds the maximum height of ${MAX_SCREENSHOT_HEIGHT} pixels; found ${MAX_SCREENSHOT_HEIGHT + 1}.`,
      ),
    )
    await assert.rejects(readFile(path.join(screenshots, "desktop.png")), { code: "ENOENT" })
  })

  it("preserves the full height of a declared template at both widths through packaging", async () => {
    const root = await temporaryDirectory()
    const screenshots = await temporaryDirectory()
    const output = path.join(await temporaryDirectory(), "package")
    await mkdir(path.join(root, "dist"))
    await mkdir(path.join(root, ".github"))
    await writeFile(
      path.join(root, "dist", "index.html"),
      '<!doctype html><html lang="en"><head><title>Template</title><style>html,body{margin:0}main{width:2200px;background:white}footer{height:100px;background:red}</style></head><body><main>Start</main><footer>End</footer><script>document.querySelector("main").style.height=location.pathname==="/journal"&&location.search==="?issue=latest"&&location.hash==="#archive"?"1800px":"100px"</script></body></html>',
    )
    await writeFile(
      path.join(root, ".github/replica.json"),
      JSON.stringify({
        version: 1,
        templates: [
          {
            id: "journal",
            name: "Journal",
            category: "Editorial",
            description: "Read the latest issue.",
            path: "/journal?issue=latest#archive",
          },
        ],
      }),
    )

    await captureScreenshots(root, screenshots)
    await createPackage(root, screenshots, output)

    for (const [name, width, rootHeight] of [
      ["desktop", 1440, 900],
      ["narrow", 390, 844],
    ]) {
      const captured = await readFile(path.join(screenshots, "templates/journal", `${name}.png`))
      const packaged = await readFile(
        path.join(output, "screenshots/templates/journal", `${name}.png`),
      )
      assert.deepEqual(packaged, captured)
      const screenshot = pngjs.PNG.sync.read(packaged)
      assert.deepEqual([screenshot.width, screenshot.height], [width, 1900])
      const bottom = (screenshot.height - 1) * screenshot.width * 4
      assert.deepEqual([...screenshot.data.subarray(bottom, bottom + 3)], [255, 0, 0])
      const rootScreenshot = pngjs.PNG.sync.read(
        await readFile(path.join(output, "screenshots", `${name}.png`)),
      )
      assert.deepEqual([rootScreenshot.width, rootScreenshot.height], [width, rootHeight])
    }
  })

  it("captures hash, pathname, dotted, and directory routes with matching metadata", async () => {
    const root = await temporaryDirectory()
    const screenshots = await temporaryDirectory()
    const output = path.join(await temporaryDirectory(), "package")
    await mkdir(path.join(root, "dist"))
    await mkdir(path.join(root, "dist/assets"))
    await mkdir(path.join(root, ".github"))
    await writeFile(
      path.join(root, "dist", "index.html"),
      '<!doctype html><html lang="en"><head><title>Templates</title><style>html,body{margin:0;height:100%;background:white}</style></head><body><script>document.body.style.background=location.hash==="#/settings"?"red":location.pathname==="/issues"&&location.search==="?state=open"?"blue":location.pathname==="/release/v2.0"?"yellow":location.pathname==="/assets"?"green":"white"</script></body></html>',
    )
    const templates = [
      {
        id: "settings",
        name: "Settings",
        category: "Configuration",
        description: "Edit account settings.",
        path: "/#/settings",
      },
      {
        id: "issues",
        name: "Issues",
        category: "Work management",
        description: "Browse open issues.",
        path: "/issues?state=open",
      },
      {
        id: "release",
        name: "Release",
        category: "Development",
        description: "Review a release.",
        path: "/release/v2.0",
      },
      {
        id: "assets",
        name: "Assets",
        category: "Development",
        description: "Browse project assets.",
        path: "/assets",
      },
    ]
    await writeFile(
      path.join(root, ".github/replica.json"),
      JSON.stringify({ version: 1, hub: { origin: "https://example.com" }, templates }),
    )

    await captureScreenshots(root, screenshots)
    await createPackage(root, screenshots, output)

    assert.deepEqual(JSON.parse(await readFile(path.join(output, "templates.json"), "utf8")), {
      version: 1,
      templates,
    })
    for (const [id, color] of [
      ["settings", [255, 0, 0]],
      ["issues", [0, 0, 255]],
      ["release", [255, 255, 0]],
      ["assets", [0, 128, 0]],
    ] as const) {
      for (const [name, width, height] of [
        ["desktop", 1440, 900],
        ["narrow", 390, 844],
      ]) {
        const screenshot = pngjs.PNG.sync.read(
          await readFile(path.join(output, "screenshots/templates", id, `${name}.png`)),
        )
        assert.deepEqual([screenshot.width, screenshot.height], [width, height])
        assert.deepEqual([...screenshot.data.subarray(0, 3)], color)
      }
    }
  })

  it("can read configuration from the source while capturing only the checked copied dist", async () => {
    const root = await temporaryDirectory()
    const configRoot = await temporaryDirectory()
    const screenshots = await temporaryDirectory()
    await mkdir(path.join(root, "dist"))
    await writeFile(path.join(root, "dist/index.html"), "<!doctype html><body>Build</body>")
    await mkdir(path.join(configRoot, ".github"))
    await writeFile(path.join(configRoot, ".github/replica.json"), '{"version":1,"templates":[]}')
    await captureScreenshots(root, screenshots, configRoot)
    assert.deepEqual(JSON.parse(await readFile(path.join(screenshots, "templates.json"), "utf8")), {
      version: 1,
      templates: [],
    })
  })
})

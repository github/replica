import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { it } from "node:test"
import { build } from "vite"
import { JSDOM } from "jsdom"
import { validateControlsDocument } from "./controls.mjs"

const result = await build({
  configFile: false,
  publicDir: false,
  logLevel: "silent",
  build: {
    write: false,
    minify: false,
    lib: {
      entry: new URL("./bindings.mjs", import.meta.url).pathname,
      formats: ["iife"],
      name: "Adapter",
    },
  },
})
const source = (Array.isArray(result) ? result[0] : result).output.find(
  (output) => output.type === "chunk",
).code
const fixture = JSON.parse(
  await readFile(new URL("./fixtures/controls.replica.json", import.meta.url)),
)

function page(t, html = "") {
  const dom = new JSDOM(`<body>${html}</body>`, {
    url: "http://prototype.local/page?view=app#section",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  })
  const window = dom.window
  window.structuredClone = (value) => window.JSON.parse(JSON.stringify(value))
  window.HTMLElement.prototype.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 30,
    height: 30,
  })
  window.document.elementFromPoint = () => window.document.querySelector("button,a")
  window.eval(source)
  let adapter
  t.after(() => {
    adapter?.dispose()
    window.close()
  })
  return {
    window,
    install(input) {
      adapter = window.Adapter.installBindings(window.structuredClone(input))
      return adapter
    },
  }
}
async function settled(check) {
  for (let i = 0; i < 100; i++) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.ok(check(), "Bindings did not settle.")
}

it("applies all value defaults, reads native edits, and runs a button only when requested", async (t) => {
  const fields = fixture.controls
    .map((control) => {
      const id = `fixture-${control.id}`
      if (control.type === "button") return `<button id="${id}">Add item</button>`
      if (control.options)
        return `<select id="${id}" ${control.type === "checkboxGroup" ? "multiple" : ""}>${control.options.map((option) => `<option>${option}</option>`).join("")}</select>`
      return `<input id="${id}" type="${control.type === "boolean" ? "checkbox" : control.type === "color" ? "color" : "text"}">`
    })
    .join("")
  const { window, install } = page(t, fields)
  let clicks = 0
  window.document.querySelector("button").onclick = () => clicks++
  const adapter = install(fixture)
  await adapter.settled()
  const controller = adapter.runtime.list()[0]
  assert.equal(window.document.querySelector("#fixture-title").value, "Preview")
  assert.equal(window.document.querySelector("#fixture-enabled").checked, true)
  assert.equal(clicks, 0)
  await adapter.update(controller, "title", "Changed")
  assert.equal(window.document.querySelector("#fixture-title").value, "Changed")
  await adapter.update(controller, "features", ["badges", "dates"])
  await adapter.update(controller, "A1", "open")
  await adapter.update(controller, "cascade", "Override")
  await adapter.update(controller, "variant", "B")
  assert.equal(window.document.querySelector("#fixture-A1").value, "A1 default")
  assert.equal(window.document.querySelector("#fixture-cascade").value, "Cascade default")
  await assert.rejects(adapter.update(controller, "A1", "Late"), /hidden/)
  await controller.action("increment")
  assert.equal(clicks, 1)
  await adapter.reset()
  assert.equal(window.document.querySelector("#fixture-title").value, "Preview")
  assert.equal(clicks, 1)
  window.document.querySelector("#fixture-title").value = "App edit"
  window.document
    .querySelector("#fixture-title")
    .dispatchEvent(new window.Event("input", { bubbles: true }))
  await settled(() => controller.getSnapshot().values.title === "App edit")
})

it("reads actual values and resets when a background preview stops painting", async (t) => {
  const { window, install } = page(t, '<input id="fixture-title">')
  window.requestAnimationFrame = () => 0
  const adapter = install({
    version: 1,
    scope: "background",
    controls: [
      {
        id: "title",
        type: "text",
        label: "Title",
        default: "Preview",
        binding: { type: "field", selector: "#fixture-title" },
      },
    ],
  })
  await adapter.settled()
  const controller = adapter.runtime.list()[0]
  assert.equal(window.document.querySelector("input").value, "Preview")
  await adapter.update(controller, "title", "Updated")
  assert.equal(controller.getSnapshot().values.title, "Updated")
  await adapter.reset()
  assert.equal(window.document.querySelector("input").value, "Preview")
  assert.equal(adapter.pending(), false)
})

it("retains page values across container replacement and resets inactive sets", async (t) => {
  const { window, install } = page(t, '<main id="page"><input id="title"></main>')
  const adapter = install({
    version: 1,
    scope: "page",
    container: "#page",
    controls: [
      {
        id: "title",
        type: "text",
        label: "Title",
        default: "Default",
        binding: { type: "field", selector: "#title" },
      },
    ],
  })
  await adapter.settled()
  const controller = adapter.runtime.list()[0]
  await adapter.update(controller, "title", "Retained")
  window.document.body.innerHTML = "<main>Other page</main>"
  await settled(() => controller.mountedCount === 0)
  window.document.body.innerHTML = '<main id="page"><input id="title"></main>'
  await settled(() => window.document.querySelector("#title").value === "Retained")
  window.document.body.innerHTML = "<main>Other page</main>"
  await settled(() => controller.mountedCount === 0)
  await adapter.reset()
  window.document.body.innerHTML = '<main id="page"><input id="title"></main>'
  await settled(() => window.document.querySelector("#title").value === "Default")
})

it("bounds hanging app APIs without blocking healthy controls or replaying writes", async (t) => {
  const { window, install } = page(t, '<input id="healthy">')
  const timeout = window.setTimeout.bind(window)
  window.setTimeout = (callback, delay, ...args) =>
    timeout(callback, delay === 5000 ? 20 : delay, ...args)
  let writes = 0
  window.appState = {
    read: () => 0,
    write: () => {
      writes++
      return new Promise(() => {})
    },
  }
  const adapter = install({
    version: 1,
    scope: "bounded",
    controls: [
      {
        id: "healthy",
        type: "text",
        label: "Healthy",
        default: "Default",
        binding: { type: "field", selector: "#healthy" },
      },
      {
        id: "hanging",
        type: "number",
        label: "Hanging",
        default: 0,
        min: 0,
        max: 10,
        binding: {
          type: "api",
          object: "appState",
          read: "read",
          write: "write",
          pollMs: 1000,
        },
      },
    ],
  })
  await adapter.settled()
  const controller = adapter.runtime.list()[0]
  assert.match(controller.getSnapshot().bindings.hanging.error, /timed out/)
  await adapter.update(controller, "healthy", "Changed")
  assert.equal(window.document.querySelector("#healthy").value, "Changed")
  assert.equal(writes, 1)
  await assert.rejects(
    adapter.update(controller, "healthy", "Stale", () => {
      throw new Error("The preview changed.")
    }),
    /preview changed/,
  )
  assert.equal(window.document.querySelector("#healthy").value, "Changed")
})

it("isolates missing, ambiguous and unsafe targets and reconnects without clicking", async (t) => {
  const { window, install } = page(
    t,
    '<input id="good"><input class="duplicate"><input class="duplicate"><form><button id="unsafe">Submit</button></form>',
  )
  let clicks = 0
  window.document.querySelector("button").onclick = () => clicks++
  const adapter = install({
    version: 1,
    scope: "safety",
    controls: [
      {
        id: "good",
        label: "Good",
        type: "text",
        default: "Works",
        binding: { type: "field", selector: "#good" },
      },
      {
        id: "missing",
        label: "Missing",
        type: "text",
        default: "Later",
        binding: { type: "field", selector: "#missing" },
      },
      {
        id: "duplicate",
        label: "Duplicate",
        type: "text",
        default: "Unique",
        binding: { type: "field", selector: ".duplicate" },
      },
      {
        id: "unsafe",
        label: "Unsafe",
        type: "button",
        binding: { type: "button", selector: "#unsafe" },
      },
    ],
  })
  await adapter.settled()
  const controller = adapter.runtime.list()[0]
  assert.match(controller.getSnapshot().bindings.missing.error, /missing/)
  assert.match(controller.getSnapshot().bindings.duplicate.error, /ambiguous/)
  assert.match(controller.getSnapshot().bindings.unsafe.error, /safe/)
  await adapter.update(controller, "good", "Still works")
  window.document.body.insertAdjacentHTML("beforeend", '<input id="missing">')
  await settled(() => window.document.querySelector("#missing").value === "Later")
  assert.equal(clicks, 0)
  await assert.rejects(controller.action("unsafe"), /safe/)
  assert.equal(clicks, 0)
  window.document.querySelector("#good").hidden = true
  await settled(() => /hidden/.test(controller.getSnapshot().bindings.good.error))
})

it("uses settled API readback, surfaces clamping and failures, and cleans notifications", async (t) => {
  const { window, install } = page(t)
  let current = 3,
    callback,
    cleanups = 0,
    reads = 0,
    actions = 0
  window.myApp = {
    read() {
      reads++
      return Promise.resolve(current)
    },
    async write(value) {
      if (value === 8) {
        current = 4
        return Promise.reject("App refused")
      }
      current = Math.min(value, 5)
    },
    listen(listener) {
      callback = listener
      return () => cleanups++
    },
    async run() {
      actions++
      return Promise.reject("Action failed")
    },
  }
  const adapter = install({
    version: 1,
    scope: "api",
    controls: [
      {
        id: "count",
        label: "Count",
        type: "number",
        min: 0,
        max: 10,
        default: 2,
        binding: {
          type: "api",
          object: "myApp",
          read: "read",
          write: "write",
          subscribe: "listen",
        },
      },
      {
        id: "run",
        label: "Run",
        type: "button",
        binding: { type: "api", object: "myApp", action: "run" },
      },
    ],
  })
  await adapter.settled()
  const controller = adapter.runtime.list()[0]
  assert.equal(current, 2)
  const before = reads
  await new Promise((resolve) => setTimeout(resolve, 300))
  assert.equal(reads, before)
  await assert.rejects(adapter.update(controller, "count", 7), /adjusted/)
  assert.equal(controller.getSnapshot().values.count, 5)
  assert.equal(controller.getSnapshot().bindings.count.available, true)
  await assert.rejects(adapter.update(controller, "count", 8), /App refused/)
  assert.equal(controller.getSnapshot().values.count, 4)
  callback()
  await adapter.settled()
  assert.equal(controller.getSnapshot().bindings.count.available, true)
  assert.match(controller.getSnapshot().bindings.count.error, /App refused/)
  await adapter.update(controller, "count", 3)
  assert.equal(controller.getSnapshot().values.count, 3)
  assert.equal(controller.getSnapshot().bindings.count.error, "")
  current = 4
  callback()
  await settled(() => controller.getSnapshot().values.count === 4)
  await assert.rejects(controller.action("run"), /Action failed/)
  await new Promise((resolve) => setTimeout(resolve, 300))
  assert.equal(actions, 1)
  adapter.dispose()
  assert.equal(cleanups, 1)
})

it("writes styles and app URL settings without replacing router state or rc settings", async (t) => {
  const { window, install } = page(t, '<main id="styled"></main>')
  window.history.replaceState(
    { router: "owned" },
    "",
    "/page?rc.page.title=%22Saved%22&view=app#section",
  )
  const adapter = install({
    version: 1,
    scope: "urlStyle",
    controls: [
      {
        id: "color",
        label: "Color",
        type: "color",
        default: "#336699",
        binding: { type: "style", selector: "#styled", property: "color" },
      },
      {
        id: "view",
        label: "View",
        type: "select",
        options: ["app", "list"],
        default: "app",
        binding: { type: "query", key: "view", mode: "in-place" },
      },
      {
        id: "hash",
        label: "Hash",
        type: "text",
        default: "section",
        binding: { type: "hash", mode: "in-place" },
      },
    ],
  })

  await adapter.settled()
  const length = window.history.length
  const controller = adapter.runtime.list()[0]
  await adapter.update(controller, "view", "list")
  await adapter.update(controller, "hash", "details")
  assert.equal(window.history.length, length)
  assert.deepEqual(window.history.state, { router: "owned" })
  assert.equal(new URLSearchParams(window.location.search).get("rc.page.title"), '"Saved"')
  assert.equal(window.location.hash, "#details")
  assert.equal(window.document.querySelector("#styled").style.color, "rgb(51, 102, 153)")
})

it("combines navigation defaults without losing Controls settings or replaying navigation", async (t) => {
  const { install } = page(t)
  const adapter = install({
    version: 1,
    scope: "navigation",
    controls: [
      {
        id: "view",
        label: "View",
        type: "text",
        default: "red",
        binding: { type: "query", key: "view", mode: "navigate" },
      },
      {
        id: "section",
        label: "Section",
        type: "text",
        default: "details",
        binding: { type: "hash", mode: "navigate" },
      },
    ],
  })
  await adapter.settled()
  const destination = new URL(adapter.takeNavigation())
  assert.equal(destination.searchParams.get("view"), "red")
  assert.equal(destination.hash, "#details")
  assert.equal(destination.pathname, "/page")
  assert.equal(adapter.takeNavigation(), undefined)
  const controller = adapter.runtime.list()[0]
  await adapter.update(controller, "view", "blue")
  assert.equal(new URL(adapter.takeNavigation()).searchParams.get("view"), "blue")
})

it("reads actual app-owned route state after a settled API write", async (t) => {
  const { window, install } = page(t)
  window.routing = {
    read: () => window.location.pathname,
    write: (pathname) => window.history.pushState({ app: true }, "", pathname),
  }
  const adapter = install({
    version: 1,
    scope: "routing",
    controls: [
      {
        id: "page",
        label: "Page",
        type: "text",
        default: "/page",
        binding: { type: "api", object: "routing", read: "read", write: "write", pollMs: 1000 },
      },
    ],
  })
  await adapter.settled()
  const controller = adapter.runtime.list()[0]
  await adapter.update(controller, "page", "/next")
  assert.equal(controller.getSnapshot().values.page, "/next")
  assert.equal(window.location.pathname, "/next")
})

it("rejects legacy documents, executable bindings, path changes and reserved URL settings", () => {
  const definition = {
    version: 1,
    scope: "valid",
    controls: [
      {
        id: "title",
        label: "Title",
        type: "text",
        default: "Title",
        binding: { type: "query", key: "title", mode: "in-place" },
      },
    ],
  }
  assert.equal(validateControlsDocument(definition), definition)
  const legacy = structuredClone(definition)
  delete legacy.controls[0].binding
  assert.throws(() => validateControlsDocument(legacy), /binding/)
  for (const binding of [
    { type: "query", key: "rc", mode: "in-place" },
    { type: "query", key: "rc.other.title", mode: "in-place" },
    { type: "pathname", mode: "navigate" },
    {
      type: "api",
      object: "myApp",
      read: "read",
      write: "write",
      pollMs: 500,
      args: ["value"],
    },
    {
      type: "api",
      object: "myApp.constructor",
      read: "read",
      write: "write",
      pollMs: 500,
    },
  ]) {
    const document = structuredClone(definition)
    document.controls[0].binding = binding
    assert.throws(() => validateControlsDocument(document))
  }
})

import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { it } from "node:test"

import { build } from "vite"
import react from "@vitejs/plugin-react"
import { JSDOM } from "jsdom"

import { viteAliases } from "../../vite-aliases.ts"

const root = fileURLToPath(new URL("../../", import.meta.url))
const declaration = JSON.parse(
  await readFile(
    new URL(
      "../../app/javascript/utils/prototype-controls/fixtures/controls.replica.json",
      import.meta.url,
    ),
    "utf8",
  ),
)
const hostEntry = "/virtual/build-controls-host.tsx"
const appEntry = "/virtual/build-controls-app.ts"
const definitions = {
  version: 1,
  sets: [
    { ...declaration, container: "#main-page" },
    {
      version: 1,
      scope: "sharedFixture",
      role: "shared",
      panel: { width: 320 },
      controls: [
        {
          id: "layoutTitle",
          label: "Layout title",
          type: "text",
          default: "Shared",
          binding: { type: "field", selector: "#shared-title" },
        },
      ],
    },
    {
      version: 1,
      scope: "otherPage",
      container: "#other-page",
      panel: { width: 450 },
      controls: [
        {
          id: "otherTitle",
          label: "Other title",
          type: "text",
          default: "Other",
          binding: { type: "field", selector: "#other-title" },
        },
      ],
    },
  ],
}
const sources = {
  [hostEntry]: `
    import { createRoot } from "react-dom/client"
    import { ThemeProvider } from "@primer/react-brand/esm"
    import { createRef } from "react"
    import { BuildControls } from "${root}app/javascript/features/build-controls/index.tsx"
    const frame = createRef()
    frame.current = document.querySelector("iframe")
    const root = createRoot(document.getElementById("controls"))
    window.fixtureUnmount = () => root.unmount()
    root.render(
      <ThemeProvider colorMode="auto"><BuildControls
        iframeRef={frame} identity={window.fixtureIdentity || "fixture"}
        origin="http://b123.preview.local" toolbar={document.getElementById("toolbar")} />
      </ThemeProvider>)
  `,
  [appEntry]: `
    const fields = ${JSON.stringify(declaration.controls)}
    document.body.innerHTML = '<input id="shared-title"><main id="main-page"></main>'
    function markup() {
      return fields.map(control => {
        const id = 'fixture-' + control.id
        if(control.type === "button") return '<button id="'+id+'">Add item</button>'
        if(control.options) return '<select id="'+id+'" '+(control.type === "checkboxGroup" ? "multiple" : "")+'>'+control.options.map(option => '<option>'+option+'</option>').join("")+'</select>'
        return '<input id="'+id+'" type="'+(control.type === "boolean" ? "checkbox" : control.type === "color" ? "color" : "text")+'">'
      }).join("")
    }
    function render() {
      document.body.dataset.title = document.querySelector("#fixture-title")?.value || ""
      document.body.dataset.count = document.querySelector("#fixture-count")?.value || ""
    }
    function mainPage() {
      document.querySelector("main").outerHTML = '<main id="main-page">'+markup()+'</main>'
      const title = document.querySelector("#fixture-title")
      title.value = "Ordinary app"
      document.querySelector("#fixture-increment").onclick = () => {
        const count = document.querySelector("#fixture-count")
        count.value = String(Number(count.value) + 1)
        count.dispatchEvent(new Event("input", {bubbles:true}))
      }
      render()
    }
    mainPage()
    document.addEventListener("input", render)
    document.addEventListener("change", render)
    window.fixture = {
      otherPage() { document.querySelector("main").outerHTML = '<main id="other-page"><input id="other-title"></main>' },
      mainPage() { mainPage() },
      setTitle(value) {
        const field = document.querySelector("#fixture-title")
        field.value = value
        field.dispatchEvent(new Event("input", {bubbles:true}))
      }
    }
  `,
}

async function bundle(entry) {
  const result = await build({
    configFile: false,
    publicDir: false,
    root,
    logLevel: "silent",
    plugins: [
      react(),
      {
        name: "build-controls-test-fixture",
        resolveId(id) {
          return Object.hasOwn(sources, id) ? id : null
        },
        load(id) {
          return sources[id]
        },
      },
    ],
    resolve: { alias: viteAliases },
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    build: {
      write: false,
      minify: false,
      lib: { entry, formats: ["iife"], name: "BuildControlsFixture" },
    },
  })
  return (Array.isArray(result) ? result[0] : result).output.find((item) => item.type === "chunk")
    .code
}
const [hostBundle, appBundle, bridge] = await Promise.all([
  bundle(hostEntry),
  bundle(appEntry),
  readFile(
    new URL(
      "../../app/javascript/features/install-replica-controls-bridge/bridge.js",
      import.meta.url,
    ),
    "utf8",
  ),
])

async function settled(check, diagnostic = () => "") {
  for (let attempt = 0; attempt < 700; attempt++) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.ok(check(), `The rendered Build controls did not settle. ${diagnostic()}`)
}
function setup(
  t,
  {
    saved,
    settings = {},
    identity = "fixture",
    appFirst = true,
    runtime = true,
    bridgeAvailable = true,
  } = {},
) {
  const dom = new JSDOM(
    '<div id="toolbar"></div><div id="controls"></div><iframe src="http://b123.preview.local/route?q=1#section"></iframe>',
    {
      url: `http://hub.local/?${new URLSearchParams(
        Object.entries(settings).flatMap(([scope, values]) =>
          Object.entries(values).map(([id, value]) => [`rc.${scope}.${id}`, JSON.stringify(value)]),
        ),
      )}`,
      runScripts: "outside-only",
    },
  )
  const parent = dom.window
  parent.fixtureMessages = []
  const child = parent.document.querySelector("iframe").contentWindow
  parent.fixtureIdentity = identity
  if (saved !== undefined)
    parent.localStorage.setItem(`replica:build-controls:v1:${identity}`, saved)
  parent.matchMedia = (media) => ({
    matches: false,
    media,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
  })
  parent.ResizeObserver = class {
    observe() {}
    disconnect() {}
  }
  parent.structuredClone = (value) => parent.JSON.parse(JSON.stringify(value))
  child.structuredClone = (value) => child.JSON.parse(JSON.stringify(value))
  child.requestAnimationFrame = (callback) => child.setTimeout(callback, 0)
  child.HTMLElement.prototype.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 30,
    height: 30,
  })
  child.document.elementFromPoint = () => child.document.querySelector("button")
  child.document.open()
  child.document.write("<html><body><h1>Build fixture</h1></body></html>")
  child.document.close()
  child.fetch = (url) => {
    assert.equal(url, "/controls.replica.json")
    return Promise.resolve(
      Response.json(runtime ? definitions : null, { status: runtime ? 200 : 404 }),
    )
  }
  parent.postMessage = (data, origin) => {
    parent.fixtureMessages.push({
      type: data.type,
      status: data.state?.status,
      error: data.error,
      scopes: data.state?.scopes?.length,
      epoch: data.epoch,
      sequence: data.sequence,
    })
    assert.equal(origin, parent.location.origin)
    setTimeout(
      () =>
        parent.dispatchEvent(
          new parent.MessageEvent("message", {
            data: parent.structuredClone(data),
            source: child,
            origin: child.location.origin,
          }),
        ),
      0,
    )
  }
  child.postMessage = (data, origin) => {
    assert.equal(origin, child.location.origin)
    setTimeout(
      () =>
        child.dispatchEvent(
          new child.MessageEvent("message", {
            data: child.structuredClone(data),
            source: parent,
            origin: parent.location.origin,
          }),
        ),
      0,
    )
  }
  if (appFirst) child.eval(appBundle)
  if (bridgeAvailable)
    child.eval(
      bridge.replace(
        /(["'`])__REPLICA_CONTROLS_PARENT_ORIGIN__\1/,
        JSON.stringify(parent.location.origin),
      ),
    )
  if (!appFirst) child.eval(appBundle)
  for (const [name, scope] of [
    ["controller", "starterFixture"],
    ["shared", "sharedFixture"],
    ["other", "otherPage"],
  ])
    Object.defineProperty(child.fixture, name, {
      get: () =>
        child[child.Symbol.for("replica.controls.injected.runtime")]
          ?.list()
          .find((controller) => controller.declaration.scope === scope),
    })
  parent.eval(hostBundle)
  t.after(() => dom.window.close())
  return {
    parent,
    child,
    saved: () => {
      const entries = [...new URLSearchParams(parent.location.search)].filter(([key]) =>
        key.startsWith("rc."),
      )
      if (!entries.length) return null
      const scopes = {}
      for (const [key, value] of entries) {
        const [, scope, id] = key.split(".")
        scopes[scope] ||= {}
        scopes[scope][id] = JSON.parse(value)
      }
      return { scopes }
    },
  }
}
function button(parent, name) {
  const found = [...parent.document.querySelectorAll("button")].find(
    (entry) => entry.textContent === name || entry.getAttribute("aria-label") === name,
  )
  assert.ok(found, `Missing button ${name}`)
  return found
}
function field(parent, label) {
  const found = [...parent.document.querySelectorAll("label")].find(
    (entry) => entry.textContent === label,
  )
  assert.ok(found, `Missing field ${label}`)
  return parent.document.getElementById(found.htmlFor)
}
async function open(parent) {
  await settled(() => parent.document.querySelector('[aria-label="Controls"]'))
  button(parent, "Controls").click()
  await settled(() => parent.document.querySelector(".canvas-controls-panel"))
}
async function change(parent, label, value) {
  const input = field(parent, label)
  if (input.type === "checkbox" || input.type === "radio") input.click()
  else {
    const prototype =
      input.tagName === "SELECT"
        ? parent.HTMLSelectElement.prototype
        : input.tagName === "TEXTAREA"
          ? parent.HTMLTextAreaElement.prototype
          : parent.HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(input, value)
    input.dispatchEvent(
      new parent.Event(input.tagName === "SELECT" || input.type === "color" ? "change" : "input", {
        bubbles: true,
      }),
    )
  }
  await new Promise((resolve) => setTimeout(resolve, 30))
}

it("uses the real Build iframe handshake and renders all eleven controls without a Vite endpoint", async (t) => {
  const { parent, child, saved } = setup(t)
  await open(parent)
  await settled(
    () => parent.document.querySelector('input[type="text"]'),
    () => parent.document.body.textContent + JSON.stringify(parent.fixtureMessages),
  )
  const frame = parent.document.querySelector("iframe")
  await change(parent, "Enabled")
  await change(parent, "Items", "4")
  await change(parent, "Layout", "grid")
  await change(parent, "3")
  await change(parent, "B")
  await change(parent, "Opacity", "0.5")
  await change(parent, "badges")
  await change(parent, "Title", "Build title")
  await change(parent, "Description", "Build description")
  await change(parent, "Accent", "#ff0000")
  await settled(
    () =>
      child.fixture.controller.getSnapshot().values.accent === "#ff0000" &&
      saved()?.scopes.starterFixture?.accent === "#ff0000",
  )
  button(parent, "Add item").click()
  await settled(() => child.document.body.dataset.count === "5")
  assert.equal(child.document.body.dataset.title, "Build title")
  assert.deepEqual(JSON.parse(JSON.stringify(child.fixture.controller.getSnapshot().values)), {
    ...Object.fromEntries(
      declaration.controls
        .filter((control) => control.type !== "button")
        .map((control) => [control.id, control.default]),
    ),
    enabled: false,
    count: 5,
    layout: "grid",
    detail: "3",
    variant: "B",
    opacity: 0.5,
    features: ["badges"],
    title: "Build title",
    description: "Build description",
    accent: "#ff0000",
  })
  await settled(() => saved()?.scopes.starterFixture?.title === "Build title")
  assert.equal(
    parent.document.querySelector(".canvas-controls-panel").style.width.includes("288px"),
    true,
  )
  button(parent, "Variant B").click()
  await settled(
    () =>
      parent.document
        .querySelector('[aria-label="Expand Variant B"]')
        ?.getAttribute("aria-expanded") === "false",
  )
  button(parent, "Collapse controls").click()
  button(parent, "Controls").click()
  await settled(() => !parent.document.querySelector(".canvas-controls-panel"))
  button(parent, "Controls").click()
  await settled(() => parent.document.querySelector(".canvas-controls-panel"))
  assert.equal(parent.document.querySelector("iframe"), frame)
  assert.equal(parent.document.querySelector(".canvas-controls-panel").dataset.collapsed, "true")
  button(parent, "Expand controls").click()
  await settled(
    () =>
      parent.document
        .querySelector('[aria-label="Expand Variant B"]')
        ?.getAttribute("aria-expanded") === "false",
  )
})

it("restores compatible values before showing fields in either script order and resets visited inactive pages", async (t) => {
  for (const appFirst of [true, false]) {
    const { parent, child, saved } = setup(t, {
      appFirst,
      settings: {
        starterFixture: { title: "Restored", count: "stale type", gone: true },
        otherPage: { otherTitle: "Saved other page" },
      },
    })
    await open(parent)
    await settled(() => parent.document.querySelector('input[value="Restored"]'))
    assert.match(parent.document.body.textContent, /Defaults were used/)
    assert.equal(child.fixture.controller.getSnapshot().values.count, 2)
    child.fixture.otherPage()
    await settled(() => parent.document.querySelector('input[value="Saved other page"]'))
    assert.equal(
      parent.document.querySelector(".canvas-controls-panel").style.width.includes("450px"),
      true,
    )
    child.fixture.mainPage()
    await settled(() => parent.document.querySelector('input[value="Restored"]'))
    button(parent, "Reset all controls").click()
    await settled(
      () => child.fixture.other.getSnapshot().values.otherTitle === "Other" && saved() === null,
    )
    assert.equal(child.fixture.controller.getSnapshot().values.title, "Preview")
    await settled(() => !parent.document.querySelector(".canvas-controls-panel [role='status']"))
    assert.doesNotMatch(parent.document.body.textContent, /All URL control settings were reset/)
  }
})

it("clears saved overrides when an app refuses a default and keeps other controls usable", async (t) => {
  const { parent, child, saved } = setup(t, {
    settings: { starterFixture: { count: 5, title: "Saved" } },
  })
  await open(parent)
  await settled(() => parent.document.querySelector('input[value="Saved"]'))
  const count = child.document.querySelector("#fixture-count")
  count.addEventListener("input", () => {
    if (count.value === "2") count.value = "5"
  })
  button(parent, "Reset all controls").click()
  await settled(() => saved() === null && child.document.body.dataset.title === "Preview")
  await settled(() => parent.document.body.textContent.includes("rejected or adjusted"))
  assert.equal(child.fixture.controller.getSnapshot().values.count, 5)
  await new Promise((resolve) => setTimeout(resolve, 600))
  assert.equal(saved(), null)
  await change(parent, "Title", "Still works")
  await settled(() => child.document.body.dataset.title === "Still works")
})

it("ignores legacy browser-saved values and never applies foreign frame or stale commands", async (t) => {
  const { parent, child } = setup(t, { saved: "false" })
  await open(parent)
  await settled(() => parent.document.querySelector('input[type="text"]'))
  assert.equal(child.fixture.controller.getSnapshot().values.title, "Preview")
  await change(parent, "Title", "In memory")
  await settled(() => child.document.body.dataset.title === "In memory")
  assert.equal(parent.localStorage.getItem("replica:build-controls:v1:fixture"), "false")
  const controller = child.fixture.controller
  const command = {
    protocol: "replica:controls",
    version: 1,
    type: "command",
    epoch: "wrong-epoch",
    requestId: "foreign",
    command: {
      operation: "update",
      scope: declaration.scope,
      fingerprint: JSON.stringify(controller.declaration),
      revision: controller.getSnapshot().revision,
      id: "title",
      value: "Injected",
    },
  }
  for (const [source, origin] of [
    [parent, "http://evil.local"],
    [child, parent.location.origin],
    [parent, parent.location.origin],
  ]) {
    child.dispatchEvent(new child.MessageEvent("message", { data: command, source, origin }))
  }
  assert.equal(controller.getSnapshot().values.title, "In memory")
  child.dispatchEvent(
    new child.MessageEvent("message", {
      data: {
        ...command,
        epoch: parent.fixtureMessages.at(-1).epoch,
        requestId: "stale-command",
        command: { ...command.command, revision: controller.getSnapshot().revision - 1 },
      },
      source: parent,
      origin: parent.location.origin,
    }),
  )
  await settled(() => /stale command/.test(parent.fixtureMessages.at(-1).error ?? ""))
  assert.equal(controller.getSnapshot().values.title, "In memory")
  await settled(() => !button(parent, "Reset all controls").disabled)
  button(parent, "Reset all controls").click()
  await settled(() => controller.getSnapshot().values.title === "Preview")
  assert.equal(parent.localStorage.getItem("replica:build-controls:v1:fixture"), "false")
  assert.equal(controller.getSnapshot().values.title, "Preview")
})

it("reports missing definitions without claiming a controls connection", async (t) => {
  const { parent } = setup(t, { runtime: false })
  await open(parent)
  await settled(() => parent.document.body.textContent.includes("No active controls"))
  assert.equal(parent.document.querySelector("input"), null)
  assert.equal(
    [...parent.document.querySelectorAll("button")].some(
      (entry) => entry.textContent === "Reset all controls",
    ),
    false,
  )
})

it("opens copied settings in a fresh viewer and uses defaults for an unconfigured URL", async (t) => {
  const first = setup(t)
  await open(first.parent)
  await settled(() => first.parent.document.querySelector('input[type="text"]'))
  await change(first.parent, "Title", "Copied title")
  await change(first.parent, "Layout", "grid")
  await settled(() => first.saved()?.scopes.starterFixture?.layout === "grid")
  const copied = setup(t, { settings: first.saved().scopes })
  await open(copied.parent)
  await settled(() => copied.child.fixture.controller.getSnapshot().values.title === "Copied title")
  assert.equal(copied.child.fixture.controller.getSnapshot().values.layout, "grid")
  const plain = setup(t, {
    saved: JSON.stringify({ version: 1, identity: "fixture", scopes: first.saved().scopes }),
  })
  await open(plain.parent)
  await settled(() => plain.parent.document.querySelector('input[type="text"]'))
  assert.equal(plain.child.fixture.controller.getSnapshot().values.title, "Preview")
  assert.equal(plain.child.fixture.controller.getSnapshot().values.layout, "list")
})

it("keeps page history and router state intact while Back and Forward restore settings", async (t) => {
  const { parent, child, saved } = setup(t)
  await open(parent)
  await settled(() => parent.document.querySelector('input[type="text"]'))
  await change(parent, "Title", "First page")
  await settled(
    () =>
      new URLSearchParams(child.location.search).get("rc.starterFixture.title") === '"First page"',
  )
  const initialLength = child.history.length
  child.history.pushState({ router: "second" }, "", "/second?filter=all#detail")
  assert.equal(child.history.length, initialLength + 1)
  await change(parent, "Title", "Second page")
  await settled(
    () =>
      saved()?.scopes.starterFixture?.title === "Second page" &&
      new URLSearchParams(child.location.search).get("rc.starterFixture.title") === '"Second page"',
  )
  assert.equal(child.history.length, initialLength + 1)
  assert.deepEqual(child.history.state, { router: "second" })
  child.history.back()
  await settled(
    () =>
      child.fixture.controller.getSnapshot().values.title === "First page" &&
      saved()?.scopes.starterFixture?.title === "First page" &&
      parent.document.querySelector('input[value="First page"]'),
  )
  assert.equal(saved().scopes.starterFixture.title, "First page")
  child.history.forward()
  await settled(
    () =>
      child.fixture.controller.getSnapshot().values.title === "Second page" &&
      saved()?.scopes.starterFixture?.title === "Second page",
    () =>
      JSON.stringify({
        url: child.location.href,
        panel: parent.document.body.textContent,
        recent: parent.fixtureMessages.slice(-5),
      }),
  )
  assert.equal(saved().scopes.starterFixture.title, "Second page")
  assert.equal(child.location.pathname, "/second")
  assert.equal(child.location.hash, "#detail")
  assert.equal(new URLSearchParams(child.location.search).get("filter"), "all")
})

it("does not resurrect a stopped connection or write stale history after unmount", async (t) => {
  const { parent, child, saved } = setup(t)
  await open(parent)
  await settled(() => parent.document.querySelector('input[type="text"]'))
  await change(parent, "Title", "Current")
  await settled(() => saved()?.scopes.starterFixture?.title === "Current")
  const address = parent.location.href
  const latest = parent.fixtureMessages.at(-1)
  const controller = child.fixture.controller
  parent.dispatchEvent(
    new parent.MessageEvent("message", {
      source: child,
      origin: child.location.origin,
      data: parent.structuredClone({
        protocol: "replica:controls",
        version: 1,
        type: "snapshot",
        requestId: "event",
        epoch: latest.epoch,
        sequence: latest.sequence + 1,
        controlQuery: "rc.starterFixture.title=%22Stale%22",
        state: {
          runtimeAvailable: true,
          status: "ready",
          scopes: [
            {
              declaration: controller.declaration,
              fingerprint: JSON.stringify(controller.declaration),
              snapshot: controller.getSnapshot(),
            },
          ],
        },
      }),
    }),
  )
  parent.fixtureUnmount()
  await new Promise((resolve) => setTimeout(resolve, 40))
  assert.equal(parent.location.href, address)
  child.fixture.setTitle("After unmount")
  await new Promise((resolve) => setTimeout(resolve, 40))
  assert.equal(parent.location.href, address)
})

it("captures synchronous app state before a router navigates and omits defaults", async (t) => {
  const { parent, child, saved } = setup(t)
  await open(parent)
  await settled(() => parent.document.querySelector('input[type="text"]'))
  child.fixture.setTitle("Synchronous")
  child.history.pushState("router-owned primitive", "", "/immediate")
  assert.equal(
    new URLSearchParams(child.location.search).get("rc.starterFixture.title"),
    '"Synchronous"',
  )
  assert.equal(child.history.state, "router-owned primitive")
  await settled(() => saved()?.scopes.starterFixture?.title === "Synchronous")
  // URL persistence can finish before React commits the corresponding field value.
  await settled(() => field(parent, "Title").value === "Synchronous")
  await change(parent, "Title", "Preview")
  await settled(() => !new URLSearchParams(parent.location.search).has("rc.starterFixture.title"))
  assert.equal(new URLSearchParams(parent.location.search).has("rc.starterFixture.count"), false)
})

it("retains settings in same-origin page links without decorating external destinations", async (t) => {
  const { parent, child } = setup(t, { settings: { starterFixture: { title: "Carry forward" } } })
  await open(parent)
  await settled(() => child.fixture.controller.getSnapshot().values.title === "Carry forward")
  child.document.body.insertAdjacentHTML(
    "beforeend",
    '<a id="next" href="/next?filter=all#details">Next page</a><a id="external" href="https://example.com/">External</a>',
  )
  for (const id of ["next", "external"]) {
    const link = child.document.getElementById(id)
    link.addEventListener("click", (event) => event.preventDefault())
    link.click()
  }
  const next = new URL(child.document.getElementById("next").href)
  assert.equal(next.pathname, "/next")
  assert.equal(next.hash, "#details")
  assert.equal(next.searchParams.get("filter"), "all")
  assert.equal(next.searchParams.get("rc.starterFixture.title"), '"Carry forward"')
  assert.equal(child.document.getElementById("external").href, "https://example.com/")
})

it("renders ordinary app state without a Replica dependency when delivery is unavailable", async (t) => {
  assert.doesNotMatch(appBundle, /replica\.controls\.runtime|validateDeclaration|controlOrder/)
  const { parent, child } = setup(t, { bridgeAvailable: false })
  assert.equal(child.document.body.dataset.title, "Ordinary app")
  assert.equal(child[child.Symbol.for("replica.controls.injected.runtime")], undefined)
  await open(parent)
  await settled(() => parent.document.body.textContent.includes("Build Controls did not connect"))
  assert.equal(parent.document.querySelector("input"), null)
  assert.equal(child.document.body.dataset.title, "Ordinary app")
})

it("disables a missing binding without disconnecting other Build controls", async (t) => {
  const { parent, child } = setup(t)
  await open(parent)
  await settled(() => parent.document.querySelector('input[type="text"]'))
  child.document.querySelector("#fixture-description").remove()
  await settled(() => field(parent, "Description").disabled)
  assert.match(parent.document.body.textContent, /binding target is missing/)
  assert.equal(field(parent, "Title").disabled, false)
  await change(parent, "Title", "Still works")
  await settled(() => child.document.body.dataset.title === "Still works")
  child.document
    .querySelector("main")
    .insertAdjacentHTML("beforeend", '<input id="fixture-description">')
  await settled(() => !field(parent, "Description").disabled)
})

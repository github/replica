import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { it } from "node:test"
import {
  createControls,
  getControlsRuntime,
  validateControls,
  validateControlsDocument,
  ControlsValidationError,
  valueIssue,
} from "./controls.mjs"

const fixture = JSON.parse(
  await readFile(new URL("./fixtures/controls.replica.json", import.meta.url)),
)
it("keeps the precompiled validator synchronized with the canonical JSON schema", () => {
  execFileSync(process.execPath, [
    new URL("./generate-controls-validator.mjs", import.meta.url).pathname,
    "--check",
  ])
})

it("validates retained definitions without installed dependencies", async () => {
  const directory = await mkdtemp(join(tmpdir(), "replica-retained-controls-"))
  try {
    for (const file of [
      "controls.mjs",
      "controls-shared.mjs",
      "controls-validation.mjs",
      "controls-shape.cjs",
      "validate-document.mjs",
    ])
      await copyFile(new URL(`./${file}`, import.meta.url), join(directory, file))
    execFileSync(process.execPath, [join(directory, "validate-document.mjs")], {
      input: JSON.stringify(fixture),
      env: { ...process.env, NODE_PATH: "" },
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it("validates the copied control sets examples", async () => {
  const reference = await readFile(
    new URL(
      "../../../../starter/.agents/skills/prototype-controls/references/sets.md",
      import.meta.url,
    ),
    "utf8",
  )
  const examples = [...reference.matchAll(/```json\n([\s\S]*?)\n```/g)]
  assert.ok(examples.length > 0)
  for (const [, example] of examples) validateControlsDocument(JSON.parse(example))
})

it("validates shared/page sets, independent IDs and strictly bounded pixel widths", () => {
  const shared = {
    ...clone(),
    scope: "sharedSettings",
    role: "shared",
    label: "Shared",
    panel: { width: 480 },
  }
  const page = {
    ...clone(),
    scope: "dashboardSettings",
    role: "page",
    panel: { width: 320 },
  }
  const document = { version: 1, sets: [shared, page] }
  assert.equal(validateControlsDocument(document), document)
  assert.throws(() => validateControls(document), ControlsValidationError)
  for (const width of [160, 4096]) validateControls({ ...page, panel: { width } })
  for (const width of [0, 159, 4097, -1, 320.5, "320", NaN, Infinity])
    assert.throws(() => validateControls({ ...page, panel: { width } }), ControlsValidationError)
  assert.throws(() => validateControls({ ...page, role: "admin" }), ControlsValidationError)
  assert.throws(
    () =>
      validateControls({
        ...page,
        panel: { width: 320, css: "position:fixed" },
      }),
    ControlsValidationError,
  )
  assert.throws(() => validateControlsDocument({ version: 1, sets: [] }), ControlsValidationError)
  assert.throws(
    () => validateControlsDocument({ ...document, controls: [] }),
    ControlsValidationError,
  )
  assert.throws(
    () =>
      validateControlsDocument({
        version: 1,
        sets: [shared, { ...page, scope: shared.scope }],
      }),
    /duplicate scope/,
  )
  const invalidPage = {
    ...page,
    controls: [
      {
        id: "heading",
        label: "Heading",
        type: "text",
        default: "Page",
        binding: { type: "field", selector: "#heading" },
        when: { control: "enabled", equals: true },
      },
    ],
  }
  assert.throws(
    () => validateControlsDocument({ version: 1, sets: [shared, invalidPage] }),
    (error) =>
      error instanceof ControlsValidationError &&
      error.issues[0].path.startsWith("/sets/1/") &&
      /reference a value control/.test(error.message),
  )
})

function clone() {
  return structuredClone(fixture)
}
function invalid(edit, pattern) {
  const input = clone()
  edit(input)
  assert.throws(
    () => validateControls(input),
    (error) =>
      error instanceof ControlsValidationError &&
      error.issues.length > 0 &&
      pattern.test(error.message),
  )
}

it("validates allowlisted branches, defaults, finite numbers, options, and bounds", () => {
  validateControls(fixture)
  invalid((d) => {
    d.extra = true
  }, /additional/)
  invalid((d) => {
    d.controls[0].script = "alert(1)"
  }, /additional/)
  invalid((d) => {
    d.controls[0].options = ["bad"]
  }, /additional/)
  invalid((d) => {
    d.controls[0].default = "true"
  }, /boolean/)
  invalid((d) => {
    d.controls[0].id = d.controls[1].id
  }, /duplicate ID/)
  invalid((d) => {
    d.groups.push(d.groups[0])
  }, /duplicate ID/)
  invalid((d) => {
    d.groups[0].id = d.controls[0].id
  }, /duplicate ID/)
  invalid((d) => {
    d.controls[2].options.push("list")
  }, /duplicate items/)
  invalid((d) => {
    d.controls[2].default = "invalid"
  }, /declared option/)
  invalid((d) => {
    d.controls[4].options.push("C", "D")
  }, /at most three/)
  invalid((d) => {
    delete d.controls[5].min
  }, /required/)
  for (const bound of ["min", "max"]) {
    invalid(
      (d) => {
        delete d.controls[1][bound]
      },
      new RegExp(`required property '${bound}'`),
    )
  }
  invalid((d) => {
    d.controls[1].min = 25
  }, /min must not exceed/)
  invalid((d) => {
    d.controls[1].step = 0
  }, /must be > 0/)
  invalid((d) => {
    d.controls[1].step = 3
  }, /align with step/)
  invalid((d) => {
    d.controls[1].default = Infinity
  }, /finite/)
  invalid((d) => {
    d.controls[1].max = NaN
  }, /finite/)
  invalid((d) => {
    d.controls[6].default = ["unknown"]
  }, /declared options/)
  invalid((d) => {
    d.controls[7].maxLength = 1
  }, /longer than/)
  invalid((d) => {
    d.controls[7].minLength = 10
    d.controls[7].maxLength = 1
  }, /minLength must not/)
  invalid((d) => {
    d.controls[9].default = "#fff"
  }, /pattern/)
  invalid((d) => {
    d.controls[10].default = 1
  }, /additional/)
  invalid((d) => {
    d.controls[11].group = "unknown"
  }, /unknown group/)
})

it("defaults number and slider increments to one and anchors decimal steps at min", () => {
  for (const type of ["number", "slider"]) {
    const control = {
      id: "value",
      label: "Value",
      type,
      min: -2,
      max: 10,
      default: 0,
    }
    validateControls({
      version: 1,
      scope: `defaultStep${type}`,
      controls: [control],
    })
    assert.equal(valueIssue(control, 1), null)
    assert.match(valueIssue(control, 0.5), /align with step/)
    assert.match(valueIssue(control, 11), /max/)
    assert.match(valueIssue(control, -3), /min/)
    assert.equal(valueIssue({ ...control, min: 0.1, step: 0.2 }, 0.3), null)
    assert.match(valueIssue({ ...control, min: 0.1, step: 0.2 }, 0.2), /align with step/)
    const store = createControls({
      version: 1,
      scope: `defaultStep${type}`,
      controls: [control],
    })
    assert.throws(() => store.update("value", 0.5), /align with step/)
    assert.equal(store.getSnapshot().values.value, 0)
    assert.throws(() => store.restore({ value: 0.5 }), /align with step/)
    assert.equal(store.getSnapshot().values.value, 0)
  }
})

it("validates condition references, operators, bounded nesting, and group dependency cycles", () => {
  invalid((d) => {
    d.controls[11].when = { control: "unknown", equals: "1" }
  }, /reference/)
  invalid((d) => {
    d.controls[11].when = { control: "increment", equals: "1" }
  }, /reference/)
  invalid((d) => {
    d.controls[11].when = { control: "detail", equals: 1 }
  }, /declared option/)
  invalid((d) => {
    d.controls[11].when = { control: "title", includes: "x" }
  }, /checkboxGroup/)
  invalid((d) => {
    d.controls[11].when = { control: "features", equals: "badges" }
  }, /must use includes/)
  invalid((d) => {
    d.controls[11].when = { control: "features", includes: "missing" }
  }, /declared checkboxGroup/)
  invalid((d) => {
    d.controls[11].when = { control: "A1", equals: "open" }
  }, /cycle/)
  invalid((d) => {
    d.groups[0].when = { control: "A1", equals: "open" }
  }, /cycle/)
  invalid((d) => {
    d.controls[7].when = { control: "description", equals: "x" }
    d.controls[8].when = { control: "title", equals: "x" }
  }, /cycle/)
  invalid((d) => {
    d.controls[11].when = { all: [] }
  }, /items/)
  invalid((d) => {
    let when = { control: "enabled", equals: true }
    for (let i = 0; i < 6; i++) when = { all: [when] }
    d.controls[11].when = when
  }, /five levels/)
})

it("updates every type and atomically resets hidden defaults even in reverse dependency order", async () => {
  const d = clone()
  d.scope = "runtimeTests"
  d.controls.reverse()
  const store = createControls(d)
  const unmount = store.mount(() => ({
    increment: () => store.update("count", store.getSnapshot().values.count + 1),
  }))
  const updates = {
    enabled: false,
    count: 4,
    layout: "grid",
    detail: "3",
    variant: "B",
    opacity: 0.5,
    features: ["badges", "dates"],
    title: "New title",
    description: "New description",
    accent: "#abcdef",
  }
  for (const [id, value] of Object.entries(updates)) store.update(id, value)
  await store.action("increment")
  assert.equal(store.getSnapshot().values.count, 5)
  assert.equal(store.getSnapshot().values.title, "New title")
  assert.equal(store.getSnapshot().visible.B3, true)
  store.update("B3", "Override")
  let notifications = 0
  const unsubscribe = store.subscribe(() => {
    notifications++
    const s = store.getSnapshot()
    assert.equal(s.values.B3, "B3 default")
    assert.equal(s.visible.B3, false)
  })
  store.update("variant", "A")
  assert.equal(notifications, 1)
  unsubscribe()
  assert.throws(() => store.update("B3", "Late"), /hidden/)
  store.update("detail", "1")
  store.update("A1", "open")
  store.update("cascade", "Override")
  store.update("variant", "B")
  assert.equal(store.getSnapshot().values.cascade, "Cascade default")
  assert.equal(store.getSnapshot().visible.cascade, false)
  store.update("variant", "A")
  assert.equal(store.getSnapshot().values.A1, "A1 default")
  assert.throws(() => store.update("count", 99), /max/)
  assert.throws(() => store.update("count", 1.5), /step/)
  assert.throws(() => store.update("title", ""), /minLength/)
  assert.throws(() => store.update("layout", "bogus"), /option/)
  assert.throws(() => store.update("accent", "#fff"), /hex/)
  assert.throws(() => store.update("features", ["badges", "badges"]), /unique/)
  assert.throws(() => store.update("increment", 1), /no value/)
  assert.throws(() => store.update("unknown", 1), /Unknown/)
  await assert.rejects(store.action("title"), /not a button/)
  store.reset("title")
  assert.equal(store.getSnapshot().values.title, "Preview")
  const same = store.getSnapshot()
  store.update("title", "Preview")
  assert.equal(store.getSnapshot(), same)
  assert.throws(() => store.getSnapshot().values.features.push("badges"), TypeError)
  store.reset()
  assert.equal(store.getSnapshot().values.count, 2)
  unmount()
})

it("reuses canonical scopes across HMR, refcounts leases, and exposes action failures", async () => {
  const d = clone()
  d.scope = "hmrTests"
  const store = createControls(d)
  store.update("count", 4)
  const { createControls: refreshed } = await import("./controls.mjs?hmr=1")
  const reordered = Object.fromEntries(Object.entries(d).reverse())
  assert.equal(refreshed(reordered), store)
  const release1 = store.mount(() => ({ increment: () => "old" }))
  function freshCallback() {
    return "fresh"
  }
  let callback = freshCallback
  const release2 = store.mount(() => ({ increment: callback }))
  assert.equal(store.mountedCount, 2)
  assert.equal(await store.action("increment"), "fresh")
  callback = async () => {
    throw new Error("Async failure")
  }
  await assert.rejects(store.action("increment"), /Async failure/)
  release2()
  release2()
  assert.equal(store.mountedCount, 1)
  assert.equal(await store.action("increment"), "old")
  release1()
  assert.equal(store.getSnapshot().values.count, 4)
  await assert.rejects(store.action("increment"), /No mounted action handler/)
  const conflict = clone()
  conflict.scope = d.scope
  conflict.controls[1].default = 5
  assert.throws(() => createControls(conflict), /Conflicting/)
  assert.equal(getControlsRuntime().version, 2)
  const key = Symbol.for("replica.controls.injected.runtime")
  const runtime = globalThis[key]
  globalThis[key] = { version: 999 }
  try {
    assert.throws(getControlsRuntime, /version mismatch/)
  } finally {
    globalThis[key] = runtime
  }
})

it("rejects hidden button actions before calling their mounted handler", async () => {
  const d = clone()
  d.scope = "hiddenActionTests"
  d.controls.find((control) => control.id === "increment").when = {
    control: "enabled",
    equals: true,
  }
  const store = createControls(d)
  let calls = 0
  const unmount = store.mount(() => ({ increment: () => calls++ }))
  store.update("enabled", false)
  await assert.rejects(store.action("increment"), /hidden/)
  assert.equal(calls, 0)
  store.update("enabled", true)
  await store.action("increment")
  assert.equal(calls, 1)
  unmount()
})

it("requires own function handlers and does not let empty newer leases shadow explicit callbacks", async () => {
  const store = createControls({
    version: 1,
    scope: "ownActionHandlers",
    controls: ["constructor", "toString"].map((id) => ({
      id,
      label: id,
      type: "button",
    })),
  })
  const empty = store.mount()
  for (const id of ["constructor", "toString"]) {
    assert.equal(store.getSnapshot().actions[id].available, false)
    await assert.rejects(store.action(id), /No mounted action handler/)
  }
  const explicit = store.mount(() => ({
    constructor: () => "own constructor",
    toString: () => "own toString",
  }))
  const newerEmpty = store.mount()
  const invalid = store.mount(() => ({ constructor: "not a function" }))
  for (const id of ["constructor", "toString"]) {
    assert.equal(store.getSnapshot().actions[id].available, true)
    assert.equal(await store.action(id), `own ${id}`)
  }
  explicit()
  for (const id of ["constructor", "toString"]) {
    assert.equal(store.getSnapshot().actions[id].available, false)
    await assert.rejects(store.action(id), /No mounted action handler/)
  }
  invalid()
  newerEmpty()
  empty()
})

it("restores drivers and dependents atomically, rejects invalid restores, and discards hidden overrides", () => {
  const d = clone()
  d.scope = "atomicRestoreTests"
  const store = createControls(d)
  let calls = 0
  const unsubscribe = store.subscribe(() => calls++)
  store.restore({ variant: "B", detail: "3", B3: "Restored B3" })
  assert.equal(calls, 1)
  assert.equal(store.getSnapshot().values.B3, "Restored B3")
  assert.equal(store.getSnapshot().visible.B3, true)
  assert.equal(store.getSnapshot().revision, 1)
  const before = store.getSnapshot()
  assert.throws(() => store.restore({ count: 4, B3: false }), /string/)
  assert.equal(store.getSnapshot(), before)
  store.restore({ variant: "A", detail: "1", B3: "Discard this" })
  assert.equal(store.getSnapshot().values.B3, "B3 default")
  assert.throws(() => store.update("B3", "late"), /hidden/)
  store.restore({ variant: "B", detail: "3" })
  assert.equal(store.getSnapshot().values.B3, "B3 default")
  unsubscribe()
})

it("encapsulates discovery, reports mount and handler availability, and handles reentrant changes", async () => {
  const d = clone()
  d.scope = "discoveryTests"
  const runtime = getControlsRuntime()
  assert.equal(runtime.scopes, undefined)
  assert.ok(Object.isFrozen(runtime.list()))
  let discoveries = 0
  const unobserve = runtime.subscribe(() => discoveries++)
  const store = createControls(d)
  assert.equal(discoveries, 1)
  let handlers = {}
  const unmount = store.mount(() => handlers)
  assert.equal(store.getSnapshot().actions.increment.available, false)
  handlers = { increment: () => Promise.resolve("done") }
  store.refreshActions()
  const ready = store.getSnapshot()
  assert.equal(ready.actions.increment.available, true)
  store.refreshActions()
  assert.equal(store.getSnapshot(), ready)
  const unsubscribe = store.subscribe(() => {
    if (store.getSnapshot().values.count === 4) store.update("count", 5)
  })
  store.update("count", 4)
  assert.equal(store.getSnapshot().values.count, 5)
  let finish
  handlers = {
    increment: () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  }
  const action = store.action("increment")
  assert.equal(store.getSnapshot().actions.increment.busy, true)
  await assert.rejects(store.action("increment"), /busy/)
  finish()
  await action
  assert.equal(store.getSnapshot().actions.increment.busy, false)
  unmount()
  assert.equal(store.mountedCount, 0)
  assert.equal(store.getSnapshot().actions.increment.available, false)
  assert.ok(discoveries > 3)
  const release = store.mount()
  assert.equal(store.getSnapshot().values.count, 5)
  release()
  unsubscribe()
  unobserve()
})

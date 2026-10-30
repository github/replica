import {
  ControlsValidationError,
  conditionMatches,
  controlOrder,
  validateControls,
  valueIssue,
} from "./controls-validation.mjs"
import { canonicalDeclaration, freeze } from "./controls-shared.mjs"

export { ControlsValidationError, validateControls, valueIssue }
export { validateControlsDocument } from "./controls-validation.mjs"

export const CONTROLS_RUNTIME_VERSION = 2
const key = Symbol.for("replica.controls.injected.runtime")
const registries = new WeakMap()

export function getControlsRuntime() {
  const existing = globalThis[key]
  if (existing && existing.version !== CONTROLS_RUNTIME_VERSION)
    throw new Error("Replica controls runtime version mismatch; reload the page")
  if (!existing) {
    const scopes = new Map()
    const listeners = new Set()
    const runtime = Object.freeze({
      version: CONTROLS_RUNTIME_VERSION,
      create: (input) => createControls(input),
      list: () => Object.freeze([...scopes.values()].map((entry) => entry.controller)),
      subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    })
    registries.set(runtime, {
      scopes,
      notify: () => {
        for (const listener of [...listeners]) listener()
      },
    })
    globalThis[key] = runtime
  }
  return globalThis[key]
}

export function createControls(input) {
  validateControls(input)
  const declaration = freeze(structuredClone(input))
  const canonical = canonicalDeclaration(declaration)
  const runtime = getControlsRuntime()
  // A second copy of the module must reuse the canonical global controller too.
  const previous = runtime
    .list()
    .find((controller) => controller.declaration.scope === declaration.scope)
  if (previous) {
    if (canonicalDeclaration(previous.declaration) !== canonical)
      throw new Error(
        `Conflicting controls declaration for scope "${declaration.scope}"; reload after schema changes`,
      )
    return previous
  }
  const registry = registries.get(runtime)
  if (!registry) return runtime.create(input)
  const controls = new Map(declaration.controls.map((c) => [c.id, c]))
  const groups = new Map((declaration.groups ?? []).map((g) => [g.id, g]))
  const order = controlOrder(declaration)
  const listeners = new Set()
  const leases = new Map()
  const busy = new Set()
  const bindings = {}
  let revision = 0
  let notifying = false
  let pending = false
  let snapshot

  function actionHandlers(id) {
    for (const getHandlers of [...leases.values()].reverse()) {
      const handlers = getHandlers()
      if (Object.hasOwn(handlers, id) && typeof handlers[id] === "function") return handlers
    }
  }

  function normalize(values) {
    const visible = {}
    for (const id of order) {
      const control = controls.get(id)
      visible[id] =
        conditionMatches(control.when, values) &&
        conditionMatches(groups.get(control.group)?.when, values)
      if (!visible[id] && control.type !== "button") values[id] = structuredClone(control.default)
    }
    const groupVisibility = Object.fromEntries(
      [...groups].map(([id, group]) => [id, conditionMatches(group.when, values)]),
    )
    const actions = Object.fromEntries(
      declaration.controls
        .filter((c) => c.type === "button")
        .map((c) => [
          c.id,
          {
            available: Boolean(actionHandlers(c.id)) && !bindings[c.id]?.error,
            busy: busy.has(c.id),
          },
        ]),
    )
    return freeze({
      values,
      visible,
      groups: groupVisibility,
      actions,
      ...(Object.keys(bindings).length ? { bindings: structuredClone(bindings) } : {}),
    })
  }
  function defaults() {
    return Object.fromEntries(
      declaration.controls
        .filter((c) => c.type !== "button")
        .map((c) => [c.id, structuredClone(c.default)]),
    )
  }
  snapshot = freeze({ ...normalize(defaults()), revision })

  function publish(values) {
    const next = normalize(values)
    const current = {
      values: snapshot.values,
      visible: snapshot.visible,
      groups: snapshot.groups,
      actions: snapshot.actions,
      ...(snapshot.bindings ? { bindings: snapshot.bindings } : {}),
    }
    if (canonicalDeclaration(next) === canonicalDeclaration(current)) return
    snapshot = freeze({ ...next, revision: ++revision })
    pending = true
    if (notifying) return
    notifying = true
    try {
      while (pending) {
        pending = false
        for (const listener of [...listeners]) listener()
        registry.notify()
      }
    } finally {
      notifying = false
    }
  }
  function requireControl(id) {
    const control = controls.get(id)
    if (!control) throw new Error(`Unknown control "${id}"`)
    if (!snapshot.visible[id]) throw new Error(`Control "${id}" is hidden`)
    return control
  }
  const controller = Object.freeze({
    declaration,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    update(id, value) {
      const control = requireControl(id)
      const error = valueIssue(control, value)
      if (error) throw new Error(`Control "${id}": ${error}`)
      publish({ ...snapshot.values, [id]: structuredClone(value) })
    },
    restore(overrides) {
      if (!overrides || typeof overrides !== "object" || Array.isArray(overrides))
        throw new Error("Controls restore requires an object")
      const values = { ...snapshot.values }
      // Validate everything before publishing; conditions run once after the merge.
      for (const [id, value] of Object.entries(overrides)) {
        const control = controls.get(id)
        if (!control) throw new Error(`Unknown control "${id}"`)
        const error = valueIssue(control, value)
        if (error) throw new Error(`Control "${id}": ${error}`)
        values[id] = structuredClone(value)
      }
      publish(values)
    },
    refreshActions() {
      publish({ ...snapshot.values })
    },
    bindingStatus(id, error, isBusy = false, available = !error) {
      if (!controls.has(id)) throw new Error(`Unknown control "${id}"`)
      bindings[id] = { error: error.slice(0, 500), busy: isBusy, available }
      publish({ ...snapshot.values })
    },
    reset(id) {
      if (id === undefined) return publish(defaults())
      const control = requireControl(id)
      if (control.type === "button") throw new Error("Buttons cannot be reset")
      publish({ ...snapshot.values, [id]: structuredClone(control.default) })
    },
    async action(id) {
      const control = requireControl(id)
      if (control.type !== "button") throw new Error(`Control "${id}" is not a button`)
      const handlers = actionHandlers(id)
      if (!handlers) throw new Error(`No mounted action handler for "${id}"`)
      if (busy.has(id)) throw new Error(`Action "${id}" is busy`)
      busy.add(id)
      publish({ ...snapshot.values })
      try {
        return await handlers[id]()
      } finally {
        busy.delete(id)
        publish({ ...snapshot.values })
      }
    },
    mount(getHandlers = () => ({})) {
      const token = Symbol()
      leases.set(token, getHandlers)
      try {
        publish({ ...snapshot.values })
        registry.notify()
      } catch (error) {
        leases.delete(token)
        publish({ ...snapshot.values })
        registry.notify()
        throw error
      }
      let mounted = true
      return () => {
        if (!mounted) return
        mounted = false
        leases.delete(token)
        publish({ ...snapshot.values })
        registry.notify()
      }
    },
    get mountedCount() {
      return leases.size
    },
  })
  registry.scopes.set(declaration.scope, Object.freeze({ canonical, controller }))
  registry.notify()
  return controller
}

import {
  createControls,
  getControlsRuntime,
  validateControlsDocument,
  valueIssue,
} from "./controls.mjs"
import { targetIssue } from "./dom-target.mjs"
import { controlOrder } from "./controls-validation.mjs"

export const CONTROLS_DOCUMENT_BYTES = 256_000

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function route() {
  const url = new URL(window.location.href)
  for (const key of [...url.searchParams.keys()])
    if (key === "rc" || key.startsWith("rc.")) url.searchParams.delete(key)
  return url.href
}

function unique(selector) {
  const matches = document.querySelectorAll(selector)
  if (matches.length !== 1)
    throw new Error(
      matches.length ? "The binding target is ambiguous." : "The binding target is missing.",
    )
  return matches[0]
}

function apiObject(name) {
  let object = window
  for (const key of name.split(".")) {
    if (!object || !Object.hasOwn(object, key))
      throw new Error(`The app API "${name}" is unavailable.`)
    object = object[key]
  }
  if (!object || (typeof object !== "object" && typeof object !== "function"))
    throw new Error(`The app API "${name}" is not an object.`)
  if ([window, window.document, window.location, window.history, window.navigator].includes(object))
    throw new Error("API bindings must use an app-owned object, not a browser API.")
  return object
}

function target(control) {
  const binding = control.binding
  if (binding.type === "api") {
    const object = apiObject(binding.object)
    for (const method of [binding.read, binding.write, binding.action, binding.subscribe].filter(
      Boolean,
    ))
      if (!Object.hasOwn(object, method) || typeof object[method] !== "function")
        throw new Error(`The app API method "${method}" is unavailable.`)
    return object
  }
  if (binding.type === "query" || binding.type === "hash") return window
  const element = unique(binding.selector)
  const error = targetIssue(element, binding.type === "button")
  if (error) throw new Error(error)
  if (binding.type === "field") {
    if (
      !(
        element instanceof HTMLInputElement ||
        element instanceof HTMLSelectElement ||
        element instanceof HTMLTextAreaElement
      ) ||
      (element instanceof HTMLInputElement &&
        ["button", "submit", "reset", "image", "file", "password", "hidden"].includes(element.type))
    )
      throw new Error("The binding requires a supported native form field.")
    if (
      control.type === "boolean" &&
      !(element instanceof HTMLInputElement && element.type === "checkbox")
    )
      throw new Error("A boolean field binding requires a checkbox.")
    if (
      control.type === "checkboxGroup" &&
      !(element instanceof HTMLSelectElement && element.multiple)
    )
      throw new Error("A checkboxGroup field binding requires a multiple select.")
    if (element.readOnly) throw new Error("The binding target is read-only.")
  }
  if (binding.type === "style" && control.type === "checkboxGroup")
    throw new Error("Style bindings require a scalar control.")
  return element
}

function decoded(control, raw) {
  if (control.type === "boolean") return raw === "true" ? true : raw === "false" ? false : raw
  if (control.type === "number" || control.type === "slider")
    return raw.trim() === "" ? NaN : Number(raw)
  if (control.type === "checkboxGroup") return JSON.parse(raw)
  if (control.type === "color" && /^rgb\(/.test(raw)) {
    const channels = raw.match(/\d+/g)
    if (channels?.length === 3)
      return `#${channels.map((value) => Number(value).toString(16).padStart(2, "0")).join("")}`
  }
  return raw
}

function encoded(value) {
  return Array.isArray(value) ? JSON.stringify(value) : String(value)
}

function read(control, object) {
  const binding = control.binding
  if (binding.type === "api") return object[binding.read]()
  if (binding.type === "field") {
    if (control.type === "boolean") return object.checked
    if (control.type === "checkboxGroup")
      return [...object.selectedOptions].map((option) => option.value)
    return decoded(control, object.value)
  }

  if (binding.type === "style")
    return decoded(
      control,
      window.getComputedStyle(object).getPropertyValue(binding.property).trim(),
    )
  const url = new URL(window.location.href)
  const raw =
    binding.type === "query"
      ? url.searchParams.get(binding.key)
      : decodeURIComponent(url.hash.slice(1))
  return raw === null ? structuredClone(control.default) : decoded(control, raw)
}

function bindingError(error) {
  const message = typeof error === "string" ? error : error?.message
  return new Error(
    typeof message === "string" && message
      ? message
      : "The app binding failed without an error message.",
  )
}

async function settledCall(invoke, timeout = 5000) {
  let timer
  try {
    return await Promise.race([
      Promise.resolve().then(invoke),
      new Promise((_, reject) => {
        timer = window.setTimeout(
          () => reject(new Error("The app API timed out. Its outcome is unknown.")),
          timeout,
        )
      }),
    ])
  } catch (error) {
    throw bindingError(error)
  } finally {
    window.clearTimeout(timer)
  }
}

function nativeValue(element, property, value) {
  const prototype =
    element instanceof HTMLInputElement
      ? HTMLInputElement.prototype
      : element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLTextAreaElement.prototype
  Object.getOwnPropertyDescriptor(prototype, property).set.call(element, value)
}

async function write(control, object, value) {
  const binding = control.binding
  if (binding.type === "api") {
    await settledCall(() => object[binding.write](structuredClone(value)))
    return
  }
  if (binding.type === "field") {
    if (object instanceof HTMLSelectElement) {
      for (const entry of Array.isArray(value) ? value : [encoded(value)]) {
        const matches = [...object.options].filter((option) => option.value === entry)
        if (
          matches.length !== 1 ||
          matches[0].disabled ||
          matches[0].closest("optgroup[disabled], [hidden], [inert]")
        )
          throw new Error("The native option is missing, ambiguous, hidden or disabled.")
      }
    }
    if (control.type === "checkboxGroup") {
      for (const option of object.options) option.selected = value.includes(option.value)
    } else if (control.type === "boolean") {
      if (object.checked !== value) object.click()
    } else nativeValue(object, "value", encoded(value))
    object.dispatchEvent(new Event("input", { bubbles: true }))
    object.dispatchEvent(new Event("change", { bubbles: true }))
    return
  }
  if (binding.type === "style") {
    object.style.setProperty(binding.property, encoded(value))
    return
  }
  const url = new URL(window.location.href)
  if (binding.type === "query") url.searchParams.set(binding.key, encoded(value))
  else url.hash = `#${encoded(value).replace(/%/g, "%25")}`
  if (url.href === window.location.href) return
  if (url.origin !== window.location.origin)
    throw new Error("URL bindings cannot leave the prototype.")
  if (binding.mode === "navigate") {
    return url
  }
  window.history.replaceState(window.history.state, "", url)
  const event = new Event(binding.type === "hash" ? "hashchange" : "popstate")
  Object.defineProperty(event, "replicaControlsBinding", { value: true })
  window.dispatchEvent(event)
}

/** Injects the shared engine without requiring imports or framework adapters in the app. */
export function installBindings(input) {
  validateControlsDocument(input)
  const declarations = input.sets ?? [input]
  const sets = declarations.map((declaration) => ({
    controller: createControls(declaration),
    release: undefined,
    records: new Map(
      declaration.controls.map((control) => [
        control.id,
        {
          control,
          object: undefined,
          cleanup: undefined,
          initialized: false,
          lastRead: 0,
          reading: false,
        },
      ]),
    ),
  }))
  let disposed = false
  let operations = 0
  let queue = Promise.resolve()
  let refreshQueue = Promise.resolve()
  let refreshPending = false
  let refreshing = false
  let navigation
  const listeners = new Set()
  let published = ""
  function notify() {
    const signature = JSON.stringify(
      sets.map(({ controller }) => [
        controller.declaration.scope,
        controller.mountedCount,
        controller.getSnapshot().revision,
      ]),
    )
    if (signature === published) return
    published = signature
    for (const listener of listeners) listener()
  }
  const releaseRuntime = getControlsRuntime().subscribe(() => {
    if (!refreshing && !operations) notify()
  })
  function active(set) {
    if (!set.controller.declaration.container) return true
    const matches = document.querySelectorAll(set.controller.declaration.container)
    if (matches.length > 1) throw new Error("The page container is ambiguous.")
    return matches.length === 1 && !targetIssue(matches[0])
  }
  function detach(set, record) {
    const cleanup = record.cleanup
    record.cleanup = undefined
    record.object = undefined
    record.initialized = false
    try {
      cleanup?.()
    } catch (error) {
      const failure = new Error(`API cleanup failed: ${bindingError(error).message}`)
      set.controller.bindingStatus(record.control.id, failure.message)
      return failure
    }
  }
  function boundTarget(control) {
    const binding = control.binding
    if (binding.type === "query" || binding.type === "hash") {
      const values = new Set()
      for (const set of sets) {
        // A malformed container disables its own set, not unrelated URL bindings.
        let mounted
        try {
          mounted = active(set)
        } catch {
          continue
        }
        if (!mounted) continue
        for (const record of set.records.values()) {
          const other = record.control.binding
          if (other.type === binding.type && (binding.type === "hash" || other.key === binding.key))
            values.add(encoded(set.controller.getSnapshot().values[record.control.id]))
        }
      }
      if (values.size > 1)
        throw new Error("This URL setting has conflicting active Controls bindings.")
    }
    return target(control)
  }
  function checkCurrent(set, record, object, expectedRoute) {
    // App-owned APIs may change routes while their shared object remains mounted.
    const changed =
      record.control.binding.type === "api"
        ? new URL(route()).origin !== new URL(expectedRoute).origin
        : route() !== expectedRoute
    if (disposed || !active(set) || changed || boundTarget(record.control) !== object)
      throw new Error("The binding target or prototype route changed. The outcome is unknown.")
  }
  async function readback(set, record, object, expectedRoute) {
    const value = await settledCall(() => read(record.control, object))
    checkCurrent(set, record, object, expectedRoute)
    const error = valueIssue(record.control, value)
    if (error) throw new Error(`The app value ${error}.`)
    set.controller.restore({ [record.control.id]: value })
    record.lastRead = Date.now()
    return value
  }
  async function apply(set, record, value) {
    const { control } = record
    const before = set.controller.getSnapshot().values[control.id]
    const expectedRoute = route()
    let object
    set.controller.bindingStatus(control.id, "", true)
    try {
      object = boundTarget(control)
      const destination = await write(control, object, value)
      if (destination) {
        const combined = new URL(navigation?.href ?? window.location.href)
        if (control.binding.type === "query")
          combined.searchParams.set(
            control.binding.key,
            destination.searchParams.get(control.binding.key),
          )
        else combined.hash = destination.hash
        navigation = combined
        set.controller.restore({ [control.id]: value })
        set.controller.bindingStatus(control.id, "")
        return value
      }
      // Background previews may stop painting; read app state after a bounded turn.
      await new Promise((resolve) => {
        const timer = window.setTimeout(() => {
          window.cancelAnimationFrame(frame)
          resolve()
        }, 100)
        const frame = window.requestAnimationFrame(() => {
          window.clearTimeout(timer)
          resolve()
        })
      })
      const urlBinding = ["query", "hash"].includes(control.binding.type)
      const actual = await readback(set, record, object, urlBinding ? route() : expectedRoute)
      if (!same(actual, value)) {
        record.rejection = "The app rejected or adjusted this value. Its actual value is shown."
        record.rejectedValue = actual
        throw new Error("The app rejected or adjusted this value. Its actual value is shown.")
      }
      record.rejection = ""
      set.controller.bindingStatus(control.id, "")
      return actual
    } catch (error) {
      let failure = bindingError(error)
      let available = false
      if (object) {
        try {
          const actual = await readback(set, record, object, expectedRoute)
          record.rejection = failure.message
          record.rejectedValue = actual
          available = true
        } catch (readError) {
          failure = new Error(`${failure.message} ${bindingError(readError).message}`)
        }
      }
      if (!available && same(set.controller.getSnapshot().values[control.id], value))
        set.controller.restore({ [control.id]: before })
      set.controller.bindingStatus(control.id, failure.message, false, available)
      throw failure
    }
  }
  async function refreshRecord(set, record) {
    const { control } = record
    if (record.reading) return
    record.reading = true
    try {
      const object = boundTarget(control)
      if (record.object !== object) {
        const failure = detach(set, record)
        if (failure) throw failure
        record.object = object
        if (control.binding.type === "api" && control.binding.subscribe) {
          const cleanup = object[control.binding.subscribe](() => {
            record.lastRead = 0
            void refresh()
          })
          if (typeof cleanup !== "function")
            throw new Error("The API notification method must return a cleanup function.")
          record.cleanup = cleanup
        }
      }
      if (control.type === "button") {
        set.controller.bindingStatus(control.id, record.rejection || "", false, true)
        return
      }
      if (!record.initialized) {
        // A failed value write is not replayed on each polling tick.
        record.initialized = true
        await apply(set, record, set.controller.getSnapshot().values[control.id])
      } else {
        const interval = control.binding.type === "api" ? control.binding.pollMs : 250
        if (record.lastRead === 0 || (interval && Date.now() - record.lastRead >= interval)) {
          if (
            !set.controller.getSnapshot().visible[control.id] &&
            !same(await settledCall(() => read(control, object)), control.default)
          )
            await apply(set, record, control.default)
          else {
            const actual = await readback(set, record, object, route())
            if (record.rejection && !same(actual, record.rejectedValue)) record.rejection = ""
          }
          set.controller.bindingStatus(control.id, record.rejection || "", false, true)
        }
      }
    } catch (error) {
      set.controller.bindingStatus(control.id, bindingError(error).message)
    } finally {
      record.reading = false
    }
  }
  function refresh() {
    if (refreshPending) return refreshQueue
    refreshPending = true
    refreshQueue = refreshQueue
      .then(async () => {
        if (disposed || operations) return
        refreshing = true
        try {
          await Promise.all(
            sets.map(async (set) => {
              let mounted
              let containerError = false
              try {
                mounted = active(set)
              } catch (error) {
                mounted = true
                containerError = true
                for (const record of set.records.values())
                  set.controller.bindingStatus(
                    record.control.id,
                    `Invalid page container: ${error.message}`,
                  )
              }
              if (!mounted) {
                set.release?.()
                set.release = undefined
                for (const record of set.records.values()) detach(set, record)
                return
              }
              if (!set.release) {
                const handlers = Object.fromEntries(
                  [...set.records.values()]
                    .filter((record) => record.control.type === "button")
                    .map((record) => [
                      record.control.id,
                      async () => {
                        const object = boundTarget(record.control)
                        const expectedRoute = route()
                        if (record.control.binding.type === "api")
                          await settledCall(() => object[record.control.binding.action](), 30_000)
                        else object.click()
                        checkCurrent(set, record, object, expectedRoute)
                      },
                    ]),
                )
                set.release = set.controller.mount(() => handlers)
              }
              if (containerError) return
              await Promise.all(
                [...set.records.values()].map((record) => refreshRecord(set, record)),
              )
            }),
          )
        } finally {
          refreshing = false
          notify()
        }
      })
      .finally(() => {
        refreshPending = false
      })
    return refreshQueue
  }
  function run(work, guard) {
    const result = queue.then(async () => {
      await refreshQueue
      guard?.()
      navigation = undefined
      operations++
      try {
        return await work()
      } catch (error) {
        navigation = undefined
        throw error
      } finally {
        operations--
        notify()
      }
    })
    queue = result.catch(() => {})
    return result
  }
  function setFor(controller) {
    const set = sets.find((set) => set.controller === controller)
    if (!set) throw new Error("Unknown controls set.")
    return set
  }
  async function values(controller, overrides, guard) {
    const set = setFor(controller)
    const before = controller.getSnapshot()
    guard?.()
    controller.restore(overrides)
    const errors = []
    for (const id of controlOrder(controller.declaration)) {
      guard?.()
      const record = set.records.get(id)
      if (record.control.type === "button") continue
      const desired = controller.getSnapshot().values[id]
      if (
        !Object.hasOwn(overrides, id) &&
        same(desired, before.values[id]) &&
        !(
          ["query", "hash"].includes(record.control.binding.type) &&
          record.control.binding.mode === "navigate"
        )
      )
        continue
      try {
        await apply(set, record, desired)
      } catch (error) {
        if (
          controller.getSnapshot().bindings[id]?.available !== true &&
          same(controller.getSnapshot().values[id], desired)
        )
          controller.restore({ [id]: before.values[id] })
        errors.push(`${record.control.label}: ${error.message}`)
      }
    }
    guard?.()
    if (errors.length) throw new Error(errors.join("\n").slice(0, 1000))
  }
  const timer = window.setInterval(() => {
    void refresh()
  }, 250)
  function appChanged(event) {
    for (const set of sets)
      for (const record of set.records.values()) {
        if (record.control.binding.type === "api" || record.control.type === "button") continue
        if (event.type === "input" || event.type === "change") {
          if (event.target !== record.object) continue
          try {
            const value = read(record.control, record.object)
            const error = valueIssue(record.control, value)
            if (error) throw new Error(`The app value ${error}.`)
            set.controller.restore({ [record.control.id]: value })
          } catch (error) {
            set.controller.bindingStatus(record.control.id, error.message)
          }
        }
        record.lastRead = 0
      }
    void refresh()
  }
  for (const name of ["input", "change", "popstate", "hashchange"])
    window.addEventListener(name, appChanged)
  void refresh()
  return {
    runtime: getControlsRuntime(),
    pending: () => operations > 0 || refreshing,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    settled: () => refreshQueue,
    restore: (controller, overrides, guard) =>
      run(() => values(controller, overrides, guard), guard),
    update: (controller, id, value, guard) =>
      run(() => {
        const control = controller.declaration.controls.find((control) => control.id === id)
        const error = !control ? "Unknown control." : valueIssue(control, value)
        if (error) throw new Error(error)
        if (!controller.getSnapshot().visible[id]) throw new Error("This control is hidden.")
        return values(controller, { [id]: value }, guard)
      }, guard),
    takeNavigation() {
      if (!navigation) return
      const destination = navigation
      navigation = undefined
      for (const key of [...destination.searchParams.keys()])
        if (key === "rc" || key.startsWith("rc.")) destination.searchParams.delete(key)
      for (const [key, value] of new URL(window.location.href).searchParams)
        if (key === "rc" || key.startsWith("rc.")) destination.searchParams.append(key, value)
      return destination.href
    },
    navigate() {
      const destination = this.takeNavigation()
      if (destination) window.location.assign(destination)
    },
    reset: (controller, guard) =>
      run(async () => {
        const selected = controller ? [setFor(controller)] : sets
        const errors = []
        for (const set of selected) {
          const defaults = Object.fromEntries(
            set.controller.declaration.controls
              .filter((control) => control.type !== "button")
              .map((control) => [control.id, control.default]),
          )
          if (!set.release) {
            set.controller.reset()
            continue
          }
          try {
            await values(set.controller, defaults, guard)
          } catch (error) {
            errors.push(error.message)
          }
        }
        if (errors.length) throw new Error(errors.join("\n").slice(0, 1000))
      }, guard),
    dispose() {
      disposed = true
      releaseRuntime()
      window.clearInterval(timer)
      for (const name of ["input", "change", "popstate", "hashchange"])
        window.removeEventListener(name, appChanged)
      for (const set of sets) {
        set.release?.()
        for (const record of set.records.values()) detach(set, record)
      }
    },
  }
}

/** Reads only this page's static definitions; ordinary apps can omit the document. */
export async function loadBindings() {
  const response = await fetch("/controls.replica.json", {
    credentials: "same-origin",
    redirect: "error",
  })
  if (response.status === 404 || response.status === 410) return undefined
  if (!response.ok) throw new Error(`controls.replica.json returned HTTP ${response.status}.`)
  let source = ""
  const reader = response.body?.getReader()
  if (reader) {
    const decoder = new TextDecoder()
    let bytes = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > CONTROLS_DOCUMENT_BYTES) {
        await reader.cancel()
        throw new Error("controls.replica.json exceeds the 256,000-byte limit.")
      }
      source += decoder.decode(value, { stream: true })
    }
    source += decoder.decode()
  } else source = await response.text()
  if (new TextEncoder().encode(source).length > CONTROLS_DOCUMENT_BYTES)
    throw new Error("controls.replica.json exceeds the 256,000-byte limit.")
  if (
    response.headers.get("content-type")?.startsWith("text/html") &&
    /^\s*<(?:!doctype html|html)/i.test(source)
  )
    return undefined
  return installBindings(JSON.parse(source))
}

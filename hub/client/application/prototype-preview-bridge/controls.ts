import { loadBindings, type Bindings } from "@utils/prototype-controls/bindings.mjs"

import {
  controlsEnvelope,
  controlsProtocol,
  controlsProtocolVersion,
  type ControlsRuntime,
  type ControlsState,
} from "@utils/prototype-controls-protocol"
import { scopeProjection } from "@utils/prototype-controls-protocol/scope-projection"
import { validControlsValues } from "@utils/prototype-controls-protocol/valid-values"
import { installControlsUrl } from "@utils/install-prototype-controls-url"
import { nonDefaultValues } from "@utils/prototype-controls-url/non-default-values"
import { controlsStatus } from "@utils/prototype-controls-status"

export function installControlsBridge(parentOrigin: string) {
  let epoch = ""
  let runtime: ControlsRuntime | undefined
  let release: (() => void) | undefined
  let previous = ""
  let disposed = false
  const seen = new Set<string>()
  let reconnectRequired = false
  let sequence = 0
  let connectionError: Pick<ControlsState, "status" | "error"> | undefined
  let bindings: Bindings | undefined
  let loaded = false
  let finishStartup: (() => void) | undefined
  const statusWaiters = new Set<() => void>()
  const restoredScopes = new Set<string>()
  let urlError = ""
  const controlsUrl = installControlsUrl(
    (query) => {
      restoredScopes.clear()
      send("snapshot", "event", undefined, query)
    },
    () =>
      Object.fromEntries(
        (runtime?.list() ?? [])
          .filter((controller) => restoredScopes.has(controller.declaration.scope))
          .map((controller) => [
            controller.declaration.scope,
            nonDefaultValues(scopeProjection(controller)),
          ]),
      ),
    (message) => {
      if (urlError === message) return
      urlError = message
      send("snapshot", "event")
    },
  )
  async function load() {
    try {
      bindings = await loadBindings()
      if (disposed) {
        bindings?.dispose()
        return
      }
      runtime = bindings?.runtime
      release = bindings?.subscribe(changed)
      await bindings?.settled()
      const startupBindings = bindings
      if (startupBindings && hasBindingErrors())
        await new Promise<void>((resolve) => {
          function finish() {
            clearTimeout(timer)
            unsubscribe()
            finishStartup = undefined
            resolve()
          }
          function check() {
            if (!hasBindingErrors()) finish()
          }
          // Allow two normal adapter discovery ticks for mount effects before showing failures.
          const timer = setTimeout(finish, 500)
          const unsubscribe = startupBindings.subscribe(check)
          finishStartup = finish
          check()
        })
    } catch (error) {
      connectionError = {
        status: "invalid-config",
        error:
          error instanceof Error
            ? error.message.slice(0, 1000)
            : "Controls definitions could not be read.",
      }
    } finally {
      loaded = true
    }
    changed()
  }
  function hasBindingErrors() {
    return runtime
      ?.list()
      .some((controller) =>
        Object.values(controller.getSnapshot().bindings ?? {}).some((binding) => binding.error),
      )
  }
  function runtimeState(): ControlsState {
    const available = Boolean(runtime)
    if (connectionError) return { runtimeAvailable: available, scopes: [], ...connectionError }
    if (!runtime)
      return {
        runtimeAvailable: false,
        status: loaded ? "no-controls" : "missing-runtime",
        scopes: [],
      }
    try {
      const scopes = runtime
        .list()
        .filter((controller) => controller.mountedCount > 0)
        .map(scopeProjection)
      if (scopes.length > 100)
        return {
          runtimeAvailable: true,
          status: "invalid-config",
          scopes: [],
          error: "Too many active controls scopes.",
        }
      return {
        runtimeAvailable: true,
        status: scopes.length ? "ready" : "no-controls",
        scopes,
      }
    } catch {
      return {
        runtimeAvailable: true,
        status: "invalid-config",
        scopes: [],
        error: "The Controls definitions are invalid.",
      }
    }
  }
  function state(): ControlsState {
    return {
      ...runtimeState(),
      scopeErrors: [],
      reconnectRequired,
      ...(reconnectRequired ? { error: "Reconnect controls before sending more commands." } : {}),
      ...(urlError
        ? { error: `${urlError} Changes remain in memory and are not in the URL.` }
        : {}),
    }
  }
  function send(
    type: "snapshot" | "reply",
    requestId: string,
    error?: string,
    controlQuery?: string,
  ) {
    if (disposed || !epoch) return
    const envelope = {
      protocol: controlsProtocol,
      version: controlsProtocolVersion,
      type,
      epoch,
      requestId,
      sequence: ++sequence,
      state: state(),
      ...(error ? { error } : {}),
      ...(controlQuery !== undefined ? { controlQuery } : {}),
    }
    window.parent.postMessage(
      controlsEnvelope(envelope)
        ? envelope
        : {
            ...envelope,
            state: {
              runtimeAvailable: true,
              status: "invalid-config",
              scopes: [],
              error: "Controls exceed the transport size limit.",
            },
            error: "Controls exceed the transport size limit.",
          },
      parentOrigin,
    )
  }
  function changed() {
    for (const notify of statusWaiters) notify()
    if (!loaded || bindings?.pending()) return
    controlsUrl?.refresh()
    const next = JSON.stringify(state())
    if (next === previous) return
    previous = next
    send("snapshot", "event")
  }
  async function receive(event: MessageEvent<unknown>) {
    if (
      event.source === window.parent &&
      event.origin === parentOrigin &&
      event.data &&
      typeof event.data === "object" &&
      "type" in event.data &&
      event.data.type === "replica:controls:status" &&
      "nonce" in event.data &&
      typeof event.data.nonce === "string" &&
      event.data.nonce.length <= 100 &&
      "timeoutMs" in event.data &&
      Number.isInteger(event.data.timeoutMs) &&
      typeof event.data.timeoutMs === "number" &&
      event.data.timeoutMs >= 0 &&
      event.data.timeoutMs <= 10_000
    ) {
      const { nonce, timeoutMs } = event.data
      function pending() {
        return (
          !loaded ||
          (bindings?.pending() === true &&
            !state().scopes.some(({ snapshot }) =>
              [...Object.values(snapshot.actions), ...Object.values(snapshot.bindings ?? {})].some(
                (binding) => binding.busy,
              ),
            ))
        )
      }
      if (pending() && timeoutMs > 0)
        await new Promise<void>((resolve) => {
          function finish() {
            clearTimeout(timer)
            statusWaiters.delete(check)
            resolve()
          }
          function check() {
            if (disposed || !pending()) finish()
          }
          const timer = setTimeout(finish, timeoutMs)
          statusWaiters.add(check)
          check()
        })
      if (!disposed)
        window.parent.postMessage(
          {
            type: "replica:controls:status-result",
            nonce,
            value: controlsStatus(state(), pending(), window.location.href),
          },
          parentOrigin,
        )
      return
    }
    if (
      event.source !== window.parent ||
      event.origin !== parentOrigin ||
      !controlsEnvelope(event.data)
    )
      return
    const data = event.data
    if (data.type === "hello") {
      epoch = data.epoch
      seen.clear()
      reconnectRequired = false
      restoredScopes.clear()
      const fromFrameUrl = data.fromFrameUrl && controlsUrl?.managed()
      controlsUrl?.set(fromFrameUrl ? controlsUrl.current() : (data.controlQuery ?? ""))
      if (!loaded) await ready
      send("reply", data.requestId, undefined, fromFrameUrl ? controlsUrl?.current() : undefined)
      return
    }
    if (data.type !== "command" || data.epoch !== epoch || seen.has(data.requestId)) return
    if (seen.size >= 2000) {
      reconnectRequired = true
      send("reply", data.requestId, "Reconnect controls before sending more commands.")
      return
    }
    seen.add(data.requestId)
    const command = data.command
    function guard() {
      if (disposed || epoch !== data.epoch)
        throw new Error("The preview reconnected. The command outcome is unknown.")
    }
    try {
      if (command?.operation === "url") {
        controlsUrl.set(command.query ?? "")
        if (
          command.scope &&
          runtime
            ?.list()
            .some(
              (controller) =>
                controller.declaration.scope === command.scope && controller.mountedCount > 0,
            )
        ) {
          restoredScopes.add(command.scope)
          controlsUrl.refresh()
        }
        send("reply", data.requestId)
        return
      }
      if (!command || !runtime || !["ready", "no-controls"].includes(state().status))
        throw new Error("Controls runtime is unavailable.")
      if (command.operation === "reset-all") {
        if (
          runtime
            .list()
            .some((controller) =>
              Object.values(controller.getSnapshot().actions).some((action) => action.busy),
            )
        )
          throw new Error("Wait for pending actions before resetting controls.")
        const active = runtime.list().filter((controller) => controller.mountedCount > 0)
        if (
          !Array.isArray(command.contexts) ||
          command.contexts.length !== active.length ||
          active.some(
            (controller) =>
              !command.contexts?.some(
                (context) =>
                  context.scope === controller.declaration.scope &&
                  context.fingerprint === JSON.stringify(controller.declaration) &&
                  context.revision === controller.getSnapshot().revision,
              ),
          )
        )
          throw new Error("Controls changed. The stale reset was not applied.")
        restoredScopes.clear()
        await bindings?.reset(undefined, guard)
      } else {
        const controller = runtime
          .list()
          .find((entry) => entry.declaration.scope === command.scope && entry.mountedCount > 0)
        if (!controller) throw new Error("This controls scope is no longer active.")
        if (
          command.fingerprint !== JSON.stringify(controller.declaration) ||
          command.revision !== controller.getSnapshot().revision
        )
          throw new Error("Controls changed. The stale command was not applied.")
        if (command.operation === "restore") {
          if (!validControlsValues(command.values)) throw new Error("Invalid saved controls.")
          await bindings?.restore(controller, command.values, guard)
          restoredScopes.add(controller.declaration.scope)
          controlsUrl?.refresh()
        } else if (command.operation === "reset") {
          restoredScopes.add(controller.declaration.scope)
          await bindings?.reset(controller, guard)
        } else {
          const control = controller.declaration.controls.find((entry) => entry.id === command.id)
          if (!control || !controller.getSnapshot().visible[control.id])
            throw new Error("This control is unknown or hidden.")
          restoredScopes.add(controller.declaration.scope)
          if (command.operation === "update") {
            const values = { [control.id]: command.value }
            if (!validControlsValues(values)) throw new Error("Invalid control value.")
            const value = values[control.id]
            if (value === undefined) throw new Error("Missing control value.")
            await bindings?.update(controller, control.id, value, guard)
          } else if (command.operation === "action") await controller.action(control.id)
          else throw new Error("Unknown controls command.")
        }
        changed()
      }
      // Never return values/results from arbitrary app callbacks.
      if (epoch === data.epoch) {
        send("reply", data.requestId)
        bindings?.navigate()
      }
    } catch (error) {
      if (epoch === data.epoch)
        send(
          "reply",
          data.requestId,
          error instanceof Error ? error.message.slice(0, 300) : "The controls command failed.",
        )
    }
  }
  const ready = load()
  function onMessage(event: MessageEvent<unknown>) {
    void receive(event)
  }
  window.addEventListener("message", onMessage)
  return () => {
    disposed = true
    finishStartup?.()
    for (const notify of statusWaiters) notify()
    release?.()
    bindings?.dispose()
    window.removeEventListener("message", onMessage)
    controlsUrl?.dispose()
  }
}

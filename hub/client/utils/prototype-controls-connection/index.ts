import { valueIssue } from "@utils/prototype-controls/controls.mjs"
import {
  controlsEnvelope,
  controlsProtocol,
  controlsProtocolVersion,
  type ControlsEnvelope,
  type ControlsState,
  type ScopeSnapshot,
} from "../prototype-controls-protocol"
import { validControlsState } from "../prototype-controls-protocol/valid-state"
import type { ControlFieldResult } from "./types"
import { nonDefaultValues } from "../prototype-controls-url/non-default-values"
import type { ControlValues } from "../prototype-controls-url/constants"
import { encodeControlValues } from "../prototype-controls-url/encode-control-values"
import { readControlQuery } from "../prototype-controls-url/read-control-query"
import { copy } from "../prototype-canvas/en"

export type SavedControls = {
  identity: string
  scopes: Record<string, Record<string, unknown>>
  storageError?: string
  notice?: string
}
type Saved = SavedControls
export type PanelState = ControlsState & {
  loading: boolean
  notice: string
  error: string
  storageError: string
  resetting: boolean
  hasResettableValues?: boolean
}
function initial(): PanelState {
  return {
    runtimeAvailable: false,
    status: "missing-runtime",
    scopes: [],
    scopeErrors: [],
    loading: true,
    notice: "",
    error: "",
    storageError: "",
    resetting: false,
  }
}
type Pending = {
  action: boolean
  resolve: (value: ControlsState) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class ControlsConnection {
  private epoch = ""
  private sequence = -1
  private state = initial()
  private listeners = new Set<() => void>()
  private pending = new Map<string, Pending>()
  private saved: Saved | undefined
  private storageReady = false
  private restored = new Set<string>()
  private preparing = new Set<string>()
  private persisted = new Map<string, string>()
  private cachedScopes = new Map<string, ScopeSnapshot>()
  private retryState?: { identity?: string; scopes: Map<string, ScopeSnapshot> }
  private resetForIdentity = false
  private fromFrameUrl = false
  private requests = new AbortController()
  private poll?: ReturnType<typeof setInterval>
  private deadline?: ReturnType<typeof setTimeout>
  private saveQueue = Promise.resolve()
  private editQueue = Promise.resolve()
  private stopped = true
  constructor(
    private frame: HTMLIFrameElement,
    private origin: string,
    private api: (options?: RequestInit) => Promise<unknown>,
    private surface: "canvas" | "build" = "canvas",
  ) {}
  getSnapshot = () => this.state
  getControlValues = (): ControlValues => {
    const values: ControlValues = structuredClone(this.saved?.scopes ?? {})
    const scopes = new Map(this.cachedScopes)
    for (const scope of this.state.scopes) scopes.set(scope.declaration.scope, scope)
    for (const [key, scope] of scopes) values[key] = nonDefaultValues(scope)
    return values
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  private publish(patch: Partial<PanelState>) {
    this.state = { ...this.state, ...patch }
    this.state.hasResettableValues = Object.values(this.getControlValues()).some(
      (values) => Object.keys(values).length > 0,
    )
    for (const listener of [...this.listeners]) listener()
  }
  private hasBindingError(scopeId?: string, id?: string) {
    return this.state.scopes.some(
      (scope) =>
        (!scopeId || scope.declaration.scope === scopeId) &&
        Object.entries(scope.snapshot.bindings ?? {}).some(
          ([key, binding]) => (!id || key === id) && Boolean(binding.error),
        ),
    )
  }
  private checkSaved(input: unknown): asserts input is Saved {
    const saved = input as Saved
    const id = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/
    if (
      !saved ||
      typeof saved !== "object" ||
      typeof saved.identity !== "string" ||
      !saved.identity ||
      saved.identity.length > 128 ||
      !saved.scopes ||
      typeof saved.scopes !== "object" ||
      Array.isArray(saved.scopes) ||
      (saved.storageError !== undefined &&
        (typeof saved.storageError !== "string" || saved.storageError.length > 1000)) ||
      (saved.notice !== undefined &&
        (typeof saved.notice !== "string" || saved.notice.length > 1000)) ||
      new Blob([JSON.stringify(saved)]).size > 270_000
    )
      throw new Error("Invalid controls storage response.")
    for (const [scope, values] of Object.entries(saved.scopes)) {
      if (!id.test(scope) || !values || typeof values !== "object" || Array.isArray(values))
        throw new Error("Invalid controls storage scope.")
      for (const [key, value] of Object.entries(values)) {
        if (
          !id.test(key) ||
          !(
            typeof value === "string" ||
            typeof value === "boolean" ||
            (typeof value === "number" && Number.isFinite(value)) ||
            (Array.isArray(value) &&
              value.length <= 100 &&
              value.every((entry) => typeof entry === "string"))
          )
        )
          throw new Error("Invalid saved control value.")
      }
    }
  }
  start = (event?: Event) => {
    this.fromFrameUrl = event?.type === "load" && this.sequence >= 0
    const interruptedAction = [...this.pending.values()].some((pending) => pending.action)
    this.stop()
    this.requests = new AbortController()
    this.stopped = false
    this.epoch = crypto.randomUUID()
    this.sequence = -1
    this.saved = undefined
    this.storageReady = false
    this.restored.clear()
    this.preparing.clear()
    this.persisted.clear()
    this.editQueue = Promise.resolve()
    this.cachedScopes.clear()
    this.retryState = undefined
    this.resetForIdentity = false
    this.state = initial()
    if (interruptedAction)
      this.state.notice =
        "The preview reconnected during an action. Its outcome is unknown; it was not replayed."
    this.publish({})
    const epoch = this.epoch
    window.addEventListener("message", this.receive)
    this.frame.addEventListener("load", this.start)
    const greet = () => {
      if (!this.storageReady) return
      // The old review loader stays compatible; controls does not depend on Hub.
      if (this.surface === "canvas")
        this.frame.contentWindow?.postMessage(
          { type: "replica:canvas:request-ready", nonce: epoch },
          this.origin,
        )
      void this.send("hello").catch(() => {})
    }
    greet()
    this.poll = setInterval(() => {
      if (this.state.status === "missing-runtime") greet()
    }, 1000)
    this.deadline = setTimeout(() => {
      if (this.state.loading)
        this.publish({
          loading: false,
          error:
            this.surface === "build"
              ? "Build Controls did not connect. Reload the preview or check its definitions."
              : copy.controlsLocalConnectionFailed,
        })
    }, 6000)
    void this.api()
      .then((saved) => {
        if (this.epoch !== epoch || this.stopped) return
        this.checkSaved(saved)
        this.saved = saved
        if (this.retryState?.identity === saved.identity) {
          for (const [key, scope] of this.retryState.scopes) {
            this.restored.add(`${key}:${scope.fingerprint}`)
            this.cachedScopes.set(key, scope)
          }
        } else if (this.retryState?.identity) {
          this.resetForIdentity = true
          this.publish({
            notice:
              "The checkout identity changed. Controls will use this branch's saved values or defaults.",
          })
        }
        this.retryState = undefined
        this.storageReady = true
        this.publish({
          storageError: saved.storageError || "",
          notice: saved.notice || this.state.notice,
        })
        void this.prepare(this.state)
        greet()
      })
      .catch((error) => {
        if (this.epoch !== epoch || this.stopped) return
        this.storageReady = true
        this.publish({
          storageError:
            this.surface === "build"
              ? error instanceof Error
                ? error.message
                : "Control settings could not be read from the URL."
              : copy.controlsLocalStorageFailed,
        })
        void this.prepare(this.state)
        greet()
      })
  }
  retry = () => {
    const retryState = { identity: this.saved?.identity, scopes: new Map(this.cachedScopes) }
    this.start()
    this.retryState = retryState
  }
  stop = () => {
    this.stopped = true
    this.requests.abort()
    clearInterval(this.poll)
    clearTimeout(this.deadline)
    window.removeEventListener("message", this.receive)
    this.frame.removeEventListener("load", this.start)
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(
        new Error(
          "The preview navigated. The command outcome is unknown; it will not be replayed.",
        ),
      )
    }
    this.pending.clear()
  }
  private receive = (event: MessageEvent<unknown>) => {
    if (
      this.stopped ||
      event.source !== this.frame.contentWindow ||
      event.origin !== this.origin ||
      !controlsEnvelope(event.data)
    )
      return
    const data = event.data
    if (
      data.epoch !== this.epoch ||
      !validControlsState(data.state) ||
      !Number.isSafeInteger(data.sequence) ||
      (data.sequence ?? -1) < 0
    )
      return
    if (data.type !== "snapshot" && data.type !== "reply") return
    const pending = this.pending.get(data.requestId)
    if (data.type === "reply" && !pending) return
    if ((data.sequence ?? -1) > this.sequence) {
      if (data.type === "snapshot" && data.controlQuery !== undefined && this.saved) {
        const parsed = readControlQuery(data.controlQuery)
        const identity = this.saved.identity
        const epoch = this.epoch
        this.stop()
        const requests = new AbortController()
        this.requests = requests
        this.publish({ loading: true })
        void this.api({
          method: "POST",
          signal: requests.signal,
          body: JSON.stringify({ identity, replace: true, scopes: parsed.scopes }),
        })
          .then(() => {
            if (this.epoch !== epoch || requests.signal.aborted) return
            this.start()
            if (parsed.notice) this.publish({ notice: parsed.notice })
          })
          .catch((error) => {
            if (this.epoch !== epoch || requests.signal.aborted) return
            this.publish({
              loading: false,
              storageError:
                error instanceof Error ? error.message : "Controls history could not be restored.",
            })
          })
        return
      }
      if (data.controlQuery !== undefined && this.saved) {
        const epoch = this.epoch
        const requests = this.requests
        const parsed = readControlQuery(data.controlQuery)
        this.saved.scopes = parsed.scopes
        this.restored.clear()
        this.persisted.clear()
        this.cachedScopes.clear()
        this.publish({ notice: parsed.notice, loading: true })
        void this.api({
          method: "POST",
          signal: requests.signal,
          body: JSON.stringify({
            identity: this.saved.identity,
            replace: true,
            scopes: parsed.scopes,
          }),
        }).catch((error) => {
          if (this.epoch !== epoch || this.stopped || requests.signal.aborted) return
          this.publish({
            storageError:
              error instanceof Error ? error.message : "Controls history could not be restored.",
          })
        })
      }
      this.sequence = data.sequence!
      const status = data.state.status
      this.publish({
        ...data.state,
        scopeErrors: data.state.scopeErrors ?? [],
        reconnectRequired: data.state.reconnectRequired === true,
        status,
        error:
          data.state.error ||
          (this.state.status === "missing-runtime" && data.state.status !== "missing-runtime"
            ? ""
            : this.state.error),
        loading:
          !this.storageReady ||
          this.state.resetting ||
          this.preparing.size > 0 ||
          (this.state.loading && status === "missing-runtime"),
      })
      void this.prepare(this.state)
    }
    if (pending) {
      this.pending.delete(data.requestId)
      clearTimeout(pending.timer)
      if (data.error) pending.reject(new Error(data.error))
      else pending.resolve(this.state)
    }
  }
  private send(type: "hello" | "command", command?: ControlsEnvelope["command"]) {
    const requestId = crypto.randomUUID()
    const envelope: ControlsEnvelope = {
      protocol: controlsProtocol,
      version: controlsProtocolVersion,
      epoch: this.epoch,
      requestId,
      type,
      ...(command ? { command } : {}),
      ...(type === "hello"
        ? {
            controlQuery: encodeControlValues(this.saved?.scopes ?? {}),
            fromFrameUrl: this.fromFrameUrl,
          }
        : {}),
    }
    if (!controlsEnvelope(envelope))
      return Promise.reject(new Error("The controls command is invalid or exceeds the size limit."))
    return new Promise<ControlsState>((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.pending.delete(requestId)
          reject(
            new Error(
              "The command timed out. Its outcome is unknown; it will not be retried automatically.",
            ),
          )
        },
        type === "hello" ? 1200 : 30_000,
      )
      this.pending.set(requestId, {
        resolve,
        reject,
        timer,
        action: command?.operation === "action",
      })
      this.frame.contentWindow?.postMessage(envelope, this.origin)
    })
  }
  private async prepare(state: ControlsState): Promise<void> {
    if (!this.saved && !this.state.storageError) return
    if (this.state.resetting || state.reconnectRequired) return
    const epoch = this.epoch
    if (this.resetForIdentity && (state.status === "ready" || state.status === "no-controls")) {
      this.resetForIdentity = false
      this.publish({ loading: true, resetting: true })
      try {
        await this.send("command", {
          operation: "reset-all",
          contexts: state.scopes.map((scope) => ({
            scope: scope.declaration.scope,
            fingerprint: scope.fingerprint,
            revision: scope.snapshot.revision,
          })),
        })
      } catch {
        if (this.epoch === epoch)
          this.publish({
            error:
              "The checkout changed, but runtime defaults could not be restored. Reload the preview before saving.",
            storageError: "Saving is paused until the new checkout's runtime reconnects.",
            loading: false,
          })
        return
      } finally {
        if (this.epoch === epoch) this.publish({ resetting: false })
      }
      if (this.epoch !== epoch || this.stopped) return
      return this.prepare(this.state)
    }
    for (const scope of state.scopes) {
      const key = scope.declaration.scope
      const fingerprint = `${key}:${scope.fingerprint}`
      if (this.preparing.has(fingerprint)) continue
      if (!this.restored.has(fingerprint)) {
        this.preparing.add(fingerprint)
        this.publish({ loading: true })
        try {
          const saved =
            this.saved?.scopes && Object.hasOwn(this.saved.scopes, key)
              ? this.saved.scopes[key]!
              : {}
          const values: Record<string, unknown> = Object.fromEntries(
            scope.declaration.controls
              .filter((control) => control.type !== "button")
              .map((control) => [control.id, structuredClone(control.default)]),
          )
          let discarded = false
          for (const [id, value] of Object.entries(saved)) {
            const control = scope.declaration.controls.find((entry) => entry.id === id)
            if (!control || valueIssue(control, value)) discarded = true
            else values[id] = value
          }
          if (Object.keys(values).length)
            await this.send("command", {
              operation: "restore",
              scope: key,
              fingerprint: scope.fingerprint,
              revision: this.state.scopes.find((entry) => entry.fingerprint === scope.fingerprint)
                ?.snapshot.revision,
              values,
            })
          if (this.stopped || this.epoch !== epoch) return
          this.restored.add(fingerprint)
          if (discarded)
            this.publish({
              notice:
                this.surface === "build"
                  ? "Some URL control settings no longer match this page. Defaults were used."
                  : "Some saved controls no longer match this declaration and were discarded.",
            })
        } catch (error) {
          if (this.epoch !== epoch || this.stopped) return
          // Binding failures already belong to the live fields and recover with their snapshots.
          if (!this.hasBindingError(key))
            this.publish({
              error:
                error instanceof Error ? error.message : "Saved controls could not be restored.",
            })
          // A racing app update leaves the panel usable; saved values are never replayed individually.
          this.restored.add(fingerprint)
        } finally {
          if (this.epoch === epoch) this.preparing.delete(fingerprint)
        }
      }
      if (this.epoch === epoch && !this.stopped) {
        const latest = this.state.scopes.find((entry) => entry.declaration.scope === key)
        if (latest) {
          this.cachedScopes.set(key, latest)
          this.persist(latest)
        }
      }
    }
    if (this.epoch === epoch && !this.stopped && this.state.status !== "missing-runtime")
      this.publish({ loading: this.preparing.size > 0 })
  }
  private persist(scope: ScopeSnapshot) {
    if (!this.saved || this.state.storageError) return
    const values = nonDefaultValues(scope)
    const serialized = JSON.stringify(values)
    if (this.persisted.get(scope.declaration.scope) === serialized) return
    this.persisted.set(scope.declaration.scope, serialized)
    const identity = this.saved.identity
    const epoch = this.epoch
    const signal = this.requests.signal
    this.saveQueue = this.saveQueue
      .catch(() => {})
      .then(async () => {
        if (this.epoch !== epoch || this.stopped) return
        try {
          await this.api({
            method: "POST",
            signal,
            body: JSON.stringify({
              identity,
              scope: scope.declaration.scope,
              values,
            }),
          })
          if (this.epoch === epoch && !this.stopped) {
            const saved = await this.api()
            this.checkSaved(saved)
            if (this.epoch !== epoch || this.stopped) return
            this.saved = saved
            await this.send("command", {
              operation: "url",
              scope: scope.declaration.scope,
              query: encodeControlValues(saved.scopes),
            })
          }
        } catch (error) {
          if (this.epoch === epoch && !this.stopped)
            this.publish({
              storageError:
                this.surface === "build" && error instanceof Error
                  ? `${error.message} Changes remain in memory and are not in the URL.`
                  : "Controls could not be saved. Changes remain in memory; use Retry to reconnect storage.",
            })
        }
      })
  }
  async command(
    operation: "update" | "action" | "reset",
    scopeId: string,
    id?: string,
    value?: unknown,
  ): Promise<ControlFieldResult> {
    if (this.state.loading || this.state.resetting || this.stopped) return
    const epoch = this.epoch
    const scope = this.state.scopes.find((entry) => entry.declaration.scope === scopeId)
    if (!scope) {
      this.publish({ error: "This controls scope is no longer active." })
      return
    }
    const apply = () => this.applyCommand(operation, scopeId, scope.fingerprint, epoch, id, value)
    if (operation !== "update") return apply()
    const result = this.editQueue.catch(() => {}).then(apply)
    this.editQueue = result.then(() => {})
    return result
  }
  private async applyCommand(
    operation: "update" | "action" | "reset",
    scopeId: string,
    fingerprint: string,
    epoch: string,
    id?: string,
    value?: unknown,
  ): Promise<ControlFieldResult> {
    if (this.epoch !== epoch || this.stopped || this.state.resetting) return
    const scope = this.state.scopes.find((entry) => entry.declaration.scope === scopeId)
    if (!scope || scope.fingerprint !== fingerprint) {
      this.publish({
        error: "The controls scope or declaration changed. The command was not applied.",
      })
      return
    }
    this.publish({ error: "" })
    try {
      if (this.state.reconnectRequired)
        throw new Error("Reconnect controls before sending more commands.")
      if (operation === "update" || operation === "action") {
        const control = scope.declaration.controls.find((entry) => entry.id === id)
        if (!control || !scope.snapshot.visible[control.id])
          throw new Error("This control is unknown or hidden.")
        if (operation === "update") {
          const error = valueIssue(control, value)
          if (error) throw new Error(`Control "${control.id}": ${error}`)
        } else if (
          control.type !== "button" ||
          !scope.snapshot.actions[control.id]?.available ||
          scope.snapshot.actions[control.id]?.busy
        )
          throw new Error("This action is unavailable or busy.")
      }
      const settled = await this.send("command", {
        operation,
        scope: scopeId,
        fingerprint: scope.fingerprint,
        revision: scope.snapshot.revision,
        ...(id ? { id } : {}),
        ...(operation === "update" ? { value } : {}),
      })
      if (operation === "update" && id)
        return {
          value: settled.scopes.find((entry) => entry.declaration.scope === scopeId)?.snapshot
            .values[id],
        }
    } catch (error) {
      if (!this.stopped && this.epoch === epoch && !this.hasBindingError(scopeId, id))
        this.publish({ error: error instanceof Error ? error.message : "Controls command failed." })
    }
  }
  async resetAll() {
    if (this.state.resetting || this.stopped) return
    const epoch = this.epoch
    this.publish({ resetting: true })
    try {
      let runtimeError = ""
      await this.editQueue.catch(() => {})
      const runtimeAvailable =
        this.state.runtimeAvailable &&
        (this.state.status === "ready" || this.state.status === "no-controls")
      if (runtimeAvailable) {
        try {
          await this.send("command", {
            operation: "reset-all",
            contexts: this.state.scopes.map((scope) => ({
              scope: scope.declaration.scope,
              fingerprint: scope.fingerprint,
              revision: scope.snapshot.revision,
            })),
          })
        } catch (error) {
          runtimeError =
            error instanceof Error ? error.message : "Some app defaults could not be restored."
        }
      }
      if (this.epoch !== epoch || this.stopped) return
      if (!this.saved) {
        const saved = await this.api()
        this.checkSaved(saved)
        this.saved = saved
      }
      await this.saveQueue.catch(() => {})
      await this.api({
        method: "POST",
        signal: this.requests.signal,
        body: JSON.stringify({ identity: this.saved.identity, reset: true }),
      })
      this.saved.scopes = {}
      await this.send("command", { operation: "url", query: "" })
      this.cachedScopes.clear()
      this.persisted.clear()
      this.publish({
        storageError: "",
        error: this.hasBindingError() ? "" : runtimeError,
        notice: runtimeAvailable
          ? ""
          : "Saved controls were cleared. Runtime defaults could not be restored until the preview reconnects.",
      })
    } catch (error) {
      if (this.epoch === epoch)
        this.publish({
          storageError: error instanceof Error ? error.message : "Reset could not be saved.",
        })
    } finally {
      if (this.epoch === epoch) this.publish({ resetting: false, loading: false })
    }
  }
}

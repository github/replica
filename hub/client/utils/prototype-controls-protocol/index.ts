import type { Controls, Declaration, Snapshot } from "@utils/prototype-controls/controls.mjs"
import { validControlsValues } from "./valid-values"

export const controlsProtocol = "replica:controls"
export const controlsProtocolVersion = 1
export const controlsMessageLimit = 512_000
export type ScopeSnapshot = {
  declaration: Declaration
  fingerprint: string
  snapshot: Snapshot<Declaration>
}
export type ControlsState = {
  runtimeAvailable: boolean
  reconnectRequired?: boolean
  status: "ready" | "no-controls" | "missing-runtime" | "unsupported-runtime" | "invalid-config"
  scopes: ScopeSnapshot[]
  scopeErrors?: readonly { scope: string; error: string }[]
  error?: string
}
export type ControlsEnvelope = {
  protocol: typeof controlsProtocol
  version: typeof controlsProtocolVersion
  epoch: string
  requestId: string
  type: "hello" | "snapshot" | "command" | "reply"
  sequence?: number
  state?: ControlsState
  error?: string
  controlQuery?: string
  fromFrameUrl?: boolean
  command?: {
    operation: "update" | "restore" | "action" | "reset" | "reset-all" | "url"
    query?: string
    scope?: string
    fingerprint?: string
    revision?: number
    id?: string
    value?: unknown
    values?: Record<string, unknown>
    contexts?: { scope: string; fingerprint: string; revision: number }[]
  }
}
export type ControlsRuntime = {
  version: 2
  list(): readonly Controls<Declaration>[]
  subscribe(listener: () => void): () => void
}

export function controlsEnvelope(value: unknown): value is ControlsEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const data = value as ControlsEnvelope
  try {
    const serialized = JSON.stringify(value)
    const validEnvelope =
      typeof serialized === "string" &&
      new Blob([serialized]).size <= controlsMessageLimit &&
      Object.keys(value).every((key) =>
        [
          "protocol",
          "version",
          "epoch",
          "requestId",
          "type",
          "sequence",
          "state",
          "error",
          "command",
          "controlQuery",
          "fromFrameUrl",
        ].includes(key),
      ) &&
      (data.error === undefined || (typeof data.error === "string" && data.error.length <= 1000)) &&
      (data.controlQuery === undefined ||
        (["hello", "snapshot", "reply"].includes(data.type) &&
          typeof data.controlQuery === "string" &&
          new Blob([data.controlQuery]).size <= 8192)) &&
      (data.fromFrameUrl === undefined ||
        (data.type === "hello" && typeof data.fromFrameUrl === "boolean")) &&
      data.protocol === controlsProtocol &&
      data.version === controlsProtocolVersion &&
      typeof data.epoch === "string" &&
      /^[a-zA-Z0-9-]{1,100}$/.test(data.epoch) &&
      typeof data.requestId === "string" &&
      /^[a-zA-Z0-9-]{1,100}$/.test(data.requestId) &&
      ["hello", "snapshot", "command", "reply"].includes(data.type)
    if (!validEnvelope) return false
    if (data.type !== "command") return data.command === undefined
    const command = data.command
    if (!command || typeof command !== "object" || Array.isArray(command)) return false
    if (command.operation === "url")
      return (
        Object.keys(command).every((key) => ["operation", "query", "scope"].includes(key)) &&
        (command.scope === undefined ||
          (typeof command.scope === "string" &&
            /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(command.scope))) &&
        typeof command.query === "string" &&
        new Blob([command.query]).size <= 8192 &&
        [...new URLSearchParams(command.query).keys()].every((key) =>
          /^rc\.[a-zA-Z][a-zA-Z0-9_-]{0,63}\.[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(key),
        )
      )
    if (command.operation === "reset-all") {
      return (
        Object.keys(command).every((key) => ["operation", "contexts"].includes(key)) &&
        Array.isArray(command.contexts) &&
        command.contexts.length <= 100 &&
        new Set(command.contexts.map((context) => context?.scope)).size ===
          command.contexts.length &&
        command.contexts.every(
          (context) =>
            context !== null &&
            typeof context === "object" &&
            Object.keys(context).length === 3 &&
            typeof context.scope === "string" &&
            /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(context.scope) &&
            typeof context.fingerprint === "string" &&
            Number.isSafeInteger(context.revision) &&
            context.revision >= 0,
        )
      )
    }
    const fields = ["operation", "scope", "fingerprint", "revision"]
    if (
      typeof command.scope !== "string" ||
      !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(command.scope) ||
      typeof command.fingerprint !== "string" ||
      !Number.isSafeInteger(command.revision) ||
      command.revision === undefined ||
      command.revision < 0
    )
      return false
    if (command.operation === "restore") {
      return (
        Object.keys(command).every((key) => [...fields, "values"].includes(key)) &&
        validControlsValues(command.values)
      )
    }
    if (command.operation === "reset")
      return Object.keys(command).every((key) => fields.includes(key))
    if (command.operation !== "action" && command.operation !== "update") return false
    if (typeof command.id !== "string" || !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(command.id))
      return false
    return (
      Object.keys(command).every((key) =>
        [...fields, "id", ...(command.operation === "update" ? ["value"] : [])].includes(key),
      ) &&
      (command.operation === "action" || validControlsValues({ [command.id]: command.value }))
    )
  } catch {
    return false
  }
}

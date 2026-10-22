import { randomUUID } from "node:crypto"
import { readHubObject } from "../read-hub-object/index.mjs"
// Allow the 8 KiB Controls query plus the underlying prototype route.
export const MAX_RELOAD_ADDRESS_LENGTH = 16_384
export function agentCommands() {
  let pending = null
  const queue = []
  const history = []
  function stage(command, name) {
    command.trace.push({ stage: name, elapsedMs: Date.now() - command.queuedAt })
  }
  function diagnostic(command) {
    return {
      id: command.id,
      type: command.type,
      rendererId: command.rendererId ?? null,
      outcome: command.outcome ?? "pending",
      stages: command.trace.map((entry) => ({ ...entry })),
    }
  }
  function startNext() {
    if (pending) return
    const command = queue.shift()
    if (!command) return
    const timer = setTimeout(() => {
      pending = null
      command.outcome = "timeout"
      command.reject(
        new Error(
          `The live canvas did not respond. Request ${command.id}; last stage: ${command.trace.at(-1)?.stage}. Keep its panel open and try again.`,
        ),
      )
      startNext()
    }, command.timeoutMs)
    command.timer = timer
    pending = command
  }
  return {
    invoke(type, input = {}, timeoutMs = 5_000) {
      return new Promise((resolve, reject) => {
        const command = {
          id: randomUUID(),
          type,
          input,
          timeoutMs,
          resolve,
          reject,
          queuedAt: Date.now(),
          trace: [],
        }
        stage(command, "queued")
        history.push(command)
        if (history.length > 20) history.shift()
        queue.push(command)
        startNext()
      })
    },
    next(rendererId) {
      if (
        rendererId !== undefined &&
        (typeof rendererId !== "string" || !/^[a-zA-Z0-9-]{1,64}$/.test(rendererId))
      )
        throw new Error("Invalid canvas renderer ID.")
      if (!pending || pending.sent) return null
      pending.sent = true
      pending.rendererId = rendererId
      stage(pending, "delivered")
      return { id: pending.id, type: pending.type, input: pending.input }
    },
    progress(input, rendererId) {
      const { id, stage: name } = readHubObject(input) ?? {}
      if (!pending || pending.id !== id || pending.rendererId !== rendererId)
        throw new Error("No matching canvas action is pending for this renderer.")
      if (name !== "handler started" && name !== "status collected")
        throw new Error("Invalid canvas action stage.")
      if (!pending.trace.some((entry) => entry.stage === name)) stage(pending, name)
    },
    diagnostics() {
      return { requests: history.map(diagnostic) }
    },
    complete(input, rendererId) {
      const result = readHubObject(input)
      if (!pending || result?.id !== pending.id || typeof result.ok !== "boolean") {
        throw new Error("No matching canvas action is pending.")
      }
      if (pending.rendererId !== rendererId)
        throw new Error("This canvas action belongs to another renderer.")
      const { resolve, reject, timer } = pending
      stage(pending, "reply received")
      pending.outcome = result.ok ? "completed" : "failed"
      clearTimeout(timer)
      pending = null
      if (result.ok) resolve(result.value)
      else
        reject(new Error(typeof result.error === "string" ? result.error : "Canvas action failed."))
      startNext()
    },
    close() {
      const error = new Error("The canvas was closed or changed during this action.")
      if (pending) {
        pending.outcome = "cancelled"
        clearTimeout(pending.timer)
        pending.reject(error)
        pending = null
      }
      for (const command of queue) {
        command.outcome = "cancelled"
        command.reject(error)
      }
      queue.length = 0
    },
  }
}

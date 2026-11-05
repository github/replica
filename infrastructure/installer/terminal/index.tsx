import { stripVTControlCharacters } from "node:util"
import { render } from "ink"

import type { WizardUI } from "../types.ts"
import { TerminalShell } from "./shell/index.tsx"
import type { Question, TerminalView } from "./view.ts"

const plain = (value: string) =>
  stripVTControlCharacters(value).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")

export function createTerminalUI(
  abort: AbortController,
  options: { fullscreen?: boolean; configureOnly?: boolean } = {},
): WizardUI & { close(): Promise<void>; summary(): string | undefined } {
  let rejectQuestion: ((error: Error) => void) | undefined
  const view: TerminalView = {
    revision: 0,
    feedback: 0,
    history: [],
    phase: "cloud",
    complete: false,
    welcome: false,
  }
  const started = performance.now()
  const fullscreen =
    options.fullscreen !== false &&
    process.env.TERM !== "dumb" &&
    process.env.INK_SCREEN_READER !== "true" &&
    (process.stdout.rows || 24) >= 20 &&
    (process.stdout.columns || 80) >= 50
  const fail = (error: Error) => {
    rejectQuestion?.(error)
    abort.abort(error)
  }
  const cancelled = () =>
    rejectQuestion?.(
      new DOMException(
        "Installation cancelled. Your draft is retained; check any retained cloud locks before retrying.",
        "AbortError",
      ),
    )
  abort.signal.addEventListener("abort", cancelled)
  const cancel = () => abort.abort()
  const edit = (value: string) => {
    if (view.question?.kind === "text" || view.question?.kind === "field")
      view.question.initial = value
  }
  const feedback = () => {
    view.feedback++
    draw()
  }
  const element = () => (
    <TerminalShell
      view={{ ...view }}
      cancel={cancel}
      fail={fail}
      edit={edit}
      feedback={feedback}
      fullscreen={fullscreen}
      configureOnly={options.configureOnly ?? false}
      started={started}
    />
  )
  const instance = render(element(), {
    exitOnCtrlC: false,
    patchConsole: false,
    alternateScreen: fullscreen,
  })
  void instance
    .waitUntilExit()
    .catch((error: unknown) =>
      fail(error instanceof Error ? error : new Error("Terminal rendering failed.")),
    )
  function draw() {
    instance.rerender(element())
  }
  function ask<T>(create: (resolve: (value: T) => void) => Question): Promise<T> {
    abort.signal.throwIfAborted()
    return new Promise((resolve, reject) => {
      rejectQuestion = reject
      view.question = create((value) => {
        if (view.question?.kind === "confirm" || view.question?.kind === "wait")
          view.notice = undefined
        view.welcome = false
        view.question = undefined
        rejectQuestion = undefined
        view.revision++
        draw()
        resolve(value)
      })
      view.revision++
      draw()
    })
  }
  return {
    cloud: () => ask<"azure">((resolve) => ({ kind: "cloud", resolve })),
    text: (message, initial = "") =>
      ask<string>((resolve) => ({
        kind: "text",
        message: plain(message),
        initial: plain(initial),
        resolve,
      })),
    field: (field, initial = "") =>
      ask<string>((resolve) => ({ kind: "field", field, initial, resolve })),
    select: (message, options) =>
      ask<string>((resolve) => ({
        kind: "select",
        message: plain(message),
        options: options.map((option) => ({ ...option, label: plain(option.label) })),
        resolve,
      })),
    confirm: (message) =>
      ask<boolean>((resolve) => ({ kind: "confirm", message: plain(message), resolve })),
    wait: (message) => ask<void>((resolve) => ({ kind: "wait", message: plain(message), resolve })),
    phase(phase) {
      view.phase = phase
      view.notice = undefined
      draw()
    },
    notice(level, message) {
      view.notice = { level, message: plain(message) }
      view.feedback++
      draw()
    },
    welcome(show) {
      view.welcome = show
      draw()
    },
    complete() {
      view.complete = true
      draw()
    },
    status(message) {
      view.history = [...view.history.slice(-19), plain(message)]
      draw()
    },
    summary: () => view.notice?.message,
    async close() {
      abort.signal.removeEventListener("abort", cancelled)
      instance.unmount()
      await instance.waitUntilExit()
    },
  }
}

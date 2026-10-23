// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest"

import { isAnnotationShortcut } from "."

afterEach(() => {
  document.body.innerHTML = ""
})

function dispatchShortcut(target: EventTarget, event: KeyboardEvent) {
  let shortcut = false
  function listener(received: KeyboardEvent) {
    shortcut = isAnnotationShortcut(received)
  }
  window.addEventListener("keydown", listener)
  try {
    target.dispatchEvent(event)
    return shortcut
  } finally {
    window.removeEventListener("keydown", listener)
  }
}

it("matches plain S without consuming modified or composing keys", () => {
  function shortcut(options: KeyboardEventInit) {
    return dispatchShortcut(
      window,
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...options }),
    )
  }

  expect(shortcut({ key: "s" })).toBe(true)
  expect(shortcut({ key: "S" })).toBe(true)
  expect(shortcut({ key: "s", ctrlKey: true })).toBe(false)
  expect(shortcut({ key: "s", isComposing: true })).toBe(false)
})

it("ignores a keydown whose key is missing", () => {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true })
  Object.defineProperty(event, "key", { value: undefined })

  expect(dispatchShortcut(window, event)).toBe(false)
})

it("ignores typing and shortcuts owned by interactive contexts", () => {
  const targets = document.createElement("div")
  targets.innerHTML = `
    <input />
    <div contenteditable="true"><span></span></div>
    <div role="menu"><button></button></div>
  `
  document.body.append(targets)

  for (const target of targets.querySelectorAll("input, span, button")) {
    expect(
      dispatchShortcut(
        target,
        new KeyboardEvent("keydown", {
          key: "s",
          bubbles: true,
          cancelable: true,
        }),
      ),
    ).toBe(false)
  }
})

it("ignores typing inside an open shadow root", () => {
  const host = document.createElement("div")
  const input = document.createElement("input")
  host.attachShadow({ mode: "open" }).append(input)
  document.body.append(host)

  expect(
    dispatchShortcut(
      input,
      new KeyboardEvent("keydown", {
        key: "s",
        bubbles: true,
        cancelable: true,
        composed: true,
      }),
    ),
  ).toBe(false)
})

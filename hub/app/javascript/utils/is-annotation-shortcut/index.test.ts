// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest"

import { asTrustedKeyboardEvent } from "@/test/as-trusted-keyboard-event"
import { isAnnotationShortcut } from "."

afterEach(() => {
  document.body.innerHTML = ""
})

function dispatchShortcut(
  target: EventTarget,
  event: KeyboardEvent,
  trusted = true,
  key: "s" | "c" | "o" = "s",
  shiftKey = false,
) {
  let shortcut = false
  function listener(received: KeyboardEvent) {
    shortcut = isAnnotationShortcut(
      trusted ? asTrustedKeyboardEvent(received) : received,
      key,
      shiftKey,
    )
  }
  window.addEventListener("keydown", listener)
  try {
    target.dispatchEvent(event)
    return shortcut
  } finally {
    window.removeEventListener("keydown", listener)
  }
}

it.each(["s", "c", "o"] as const)(
  "matches plain %s without consuming modified or composing keys",
  (key) => {
    function shortcut(options: KeyboardEventInit) {
      return dispatchShortcut(
        window,
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...options }),
        true,
        key,
      )
    }

    expect(shortcut({ key })).toBe(true)
    expect(shortcut({ key: key.toUpperCase() })).toBe(true)
    for (const guard of ["ctrlKey", "metaKey", "altKey", "shiftKey", "repeat", "isComposing"]) {
      expect(shortcut({ key, [guard]: true })).toBe(false)
    }
  },
)

it.each(["s", "c", "o"] as const)("ignores untrusted %s keydown events", (key) => {
  expect(
    dispatchShortcut(
      window,
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
      false,
      key,
    ),
  ).toBe(false)
})

it("ignores a keydown whose key is missing", () => {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true })
  Object.defineProperty(event, "key", { value: undefined })

  expect(dispatchShortcut(window, event)).toBe(false)
})

it.each(["s", "c", "o"] as const)("ignores typing and %s owned by interactive contexts", (key) => {
  const targets = document.createElement("div")
  targets.innerHTML = `
    <input />
    <textarea></textarea>
    <select></select>
    <div contenteditable="true"><span></span></div>
    <div role="menu"><button></button></div>
    <div role="dialog"><button></button></div>
    <div role="textbox"></div>
    <div role="combobox"></div>
  `
  document.body.append(targets)

  for (const target of targets.querySelectorAll(
    'input, textarea, select, span, button, [role="textbox"], [role="combobox"]',
  )) {
    expect(
      dispatchShortcut(
        target,
        new KeyboardEvent("keydown", {
          key,
          bubbles: true,
          cancelable: true,
        }),
        true,
        key,
      ),
    ).toBe(false)
  }
})

it.each(["s", "c", "o"] as const)("ignores %s inside an open shadow root", (key) => {
  const host = document.createElement("div")
  const input = document.createElement("input")
  host.attachShadow({ mode: "open" }).append(input)
  document.body.append(host)

  expect(
    dispatchShortcut(
      input,
      new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
        composed: true,
      }),
      true,
      key,
    ),
  ).toBe(false)
})

it("matches Shift+C without consuming other modifiers, repeated keys, or typing", () => {
  function shortcut(options: KeyboardEventInit, target: EventTarget = window, trusted = true) {
    return dispatchShortcut(
      target,
      new KeyboardEvent("keydown", {
        key: "C",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
        composed: true,
        ...options,
      }),
      trusted,
      "c",
      true,
    )
  }

  expect(shortcut({})).toBe(true)
  expect(shortcut({ key: "c" })).toBe(true)
  expect(shortcut({ shiftKey: false })).toBe(false)
  expect(shortcut({ key: "S" })).toBe(false)
  for (const guard of ["ctrlKey", "metaKey", "altKey", "repeat", "isComposing"]) {
    expect(shortcut({ [guard]: true })).toBe(false)
  }
  expect(shortcut({}, window, false)).toBe(false)

  const host = document.createElement("div")
  const input = document.createElement("input")
  const editable = document.createElement("div")
  editable.setAttribute("contenteditable", "true")
  host.attachShadow({ mode: "open" }).append(input)
  document.body.append(host, editable)
  expect(shortcut({}, input)).toBe(false)
  expect(shortcut({}, editable)).toBe(false)
})

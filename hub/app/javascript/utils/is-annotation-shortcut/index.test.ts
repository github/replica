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

it("ignores a keydown whose key is missing", () => {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true })
  Object.defineProperty(event, "key", { value: undefined })

  expect(dispatchShortcut(window, event)).toBe(false)
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

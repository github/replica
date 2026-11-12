import "@testing-library/jest-dom/vitest"
import { cleanup } from "@testing-library/react"
import { beforeEach } from "vitest"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

class ResizeObserverMock {
  constructor() {}

  disconnect() {}

  observe() {}

  unobserve() {}
}

Object.defineProperty(globalThis, "ResizeObserver", {
  configurable: true,
  writable: true,
  value: ResizeObserverMock,
})

Object.defineProperty(Document.prototype, "adoptedStyleSheets", {
  configurable: true,
  writable: true,
  value: [],
})

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }),
})

// jsdom does not implement the popover and modal APIs used by canvas controls.
Object.defineProperties(HTMLElement.prototype, {
  showPopover: {
    configurable: true,
    writable: true,
    value(this: HTMLElement) {
      if (!this.hasAttribute("popover"))
        throw new Error("Tooltip was focused before popover initialization.")
    },
  },
  hidePopover: { configurable: true, writable: true, value() {} },
})

Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
  configurable: true,
  writable: true,
  value(this: HTMLDialogElement) {
    this.open = true
  },
})

Object.defineProperty(HTMLDialogElement.prototype, "close", {
  configurable: true,
  writable: true,
  value(this: HTMLDialogElement) {
    this.open = false
    this.dispatchEvent(new Event("close"))
  },
})

beforeEach(() => {
  cleanup()
  window.localStorage.clear()
  window.sessionStorage.clear()
  window.history.replaceState(null, "", "/")
  window.getSelection()?.removeAllRanges()
  document.body.replaceChildren()
  document.body.removeAttribute("style")
})

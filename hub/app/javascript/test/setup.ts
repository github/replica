import "@testing-library/jest-dom/vitest"
import { afterEach, vi } from "vitest"

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

// Keep Brand on the native-popover path instead of replacing these stubs with its polyfill.
const openPopovers = new WeakSet<HTMLElement>()
Object.defineProperties(HTMLElement.prototype, {
  popover: {
    configurable: true,
    get(this: HTMLElement) {
      return this.getAttribute("popover")
    },
    set(this: HTMLElement, value: string | null) {
      if (value === null) this.removeAttribute("popover")
      else this.setAttribute("popover", value)
    },
  },
  matches: {
    configurable: true,
    writable: true,
    value(this: HTMLElement, selector: string) {
      return selector === ":popover-open"
        ? openPopovers.has(this)
        : Element.prototype.matches.call(this, selector)
    },
  },
  showPopover: {
    configurable: true,
    writable: true,
    value(this: HTMLElement) {
      if (!this.hasAttribute("popover"))
        throw new Error("Tooltip was focused before popover initialization.")
      openPopovers.add(this)
      this.dispatchEvent(new Event("toggle"))
    },
  },
  hidePopover: {
    configurable: true,
    writable: true,
    value(this: HTMLElement) {
      openPopovers.delete(this)
      this.dispatchEvent(new Event("toggle"))
    },
  },
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

afterEach(() => {
  vi.useRealTimers()
})

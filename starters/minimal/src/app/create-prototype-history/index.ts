import { createBrowserHistory, parseHref } from "@tanstack/history"

export function createPrototypeHistory(win: Window = window) {
  return createBrowserHistory({
    window: win,
    parseLocation: () => {
      const [route = "/", ...fragments] = win.location.hash.split("#").slice(1)
      const href = route.startsWith("/")
        ? `${route}${win.location.search}${fragments.length ? `#${fragments.join("#")}` : ""}`
        : `/${win.location.search}${win.location.hash}`
      return parseHref(href, win.history.state)
    },
    createHref: (href) =>
      `${win.location.pathname}${win.location.search}${href.startsWith("/#") ? href.slice(1) : `#${href}`}`,
  })
}

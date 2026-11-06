import { setupWorker } from "msw/browser"

import { createMockHandlers } from "../create-mock-handlers"
import { createMockStore } from "../create-mock-store"
import { mockDiagnostics } from "../diagnostics"

export async function startMockApi(): Promise<void> {
  mockDiagnostics.initialize()
  const store = createMockStore({ origin: window.location.origin })
  store.session.select(mockDiagnostics.getSnapshot().profile)
  const worker = setupWorker(...createMockHandlers(store))
  worker.events.on("response:mocked", ({ request, response }) => {
    const url = new URL(request.url)
    if (
      url.origin !== store.origin ||
      (!url.pathname.startsWith("/api/") && !/^\/notifications\/\d+$/.test(url.pathname))
    )
      return
    if (url.pathname === "/api/session" && response.ok) {
      mockDiagnostics.selectProfile(store.session.read().profile)
    }
    if (!["GET", "HEAD"].includes(request.method) || response.status >= 400) {
      mockDiagnostics.report(
        `${request.method} ${url.pathname}: HTTP ${response.status}. Local data only.`,
      )
    }
  })
  try {
    await worker.start({
      quiet: true,
      serviceWorker: { url: `${import.meta.env.BASE_URL}mockServiceWorker.js` },
      onUnhandledRequest(request) {
        const url = new URL(request.url)
        if (url.origin === window.location.origin && url.pathname.startsWith("/api/")) {
          mockDiagnostics.report(
            `No mock response is configured for ${request.method} ${url.pathname}.`,
          )
          throw new Error("No local API response is configured for this request.")
        }
      },
    })
  } catch (error) {
    worker.stop()
    mockDiagnostics.report("The local API could not start. Check the browser console and retry.")
    throw error
  }
  import.meta.hot?.dispose(() => {
    worker.stop()
  })
}

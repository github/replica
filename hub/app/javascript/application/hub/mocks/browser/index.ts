import { setupWorker } from "msw/browser"

import { createMockHandlers } from "../create-handlers"
import { createMockStore } from "../create-store"

export async function startMockApi(): Promise<void> {
  const store = createMockStore({ origin: window.location.origin })
  const worker = setupWorker(...createMockHandlers(store))
  try {
    await worker.start({
      serviceWorker: { url: `${import.meta.env.BASE_URL}mockServiceWorker.js` },
      onUnhandledRequest(request, print) {
        const url = new URL(request.url)
        if (url.origin === window.location.origin && url.pathname.startsWith("/api/")) {
          print.error()
        }
      },
    })
  } catch (error) {
    worker.stop()
    throw error
  }
  import.meta.hot?.dispose(() => worker.stop())
}

import { expect, onTestFinished, vi } from "vitest"

type Respond = (request: {
  request: Request
  params: Record<string, string>
}) => Response | Promise<Response>

export interface HubHttpHandler {
  method: string
  path: string
  respond: Respond
}

function handler(method: string) {
  return (path: string, respond: Respond): HubHttpHandler => ({ method, path, respond })
}

export const http = {
  get: handler("GET"),
  post: handler("POST"),
  patch: handler("PATCH"),
  delete: handler("DELETE"),
}

function matchPath(pattern: string, request: URL) {
  const expected = new URL(pattern, window.location.origin)
  if (expected.origin !== request.origin) return
  const parts = expected.pathname.split("/")
  const actual = request.pathname.split("/")
  if (parts.length !== actual.length) return
  const params: Record<string, string> = {}
  for (const [index, part] of parts.entries()) {
    const segment = actual[index]!
    if (part.startsWith(":") && segment) params[part.slice(1)] = decodeURIComponent(segment)
    else if (part !== segment) return
  }
  return params
}

export function stubHubFetch(...initial: HubHttpHandler[]) {
  let handlers = initial
  const requests: Request[] = []
  const unhandled: string[] = []
  const pending = new Set<Request>()
  const responseListeners = new Set<(request: Request) => void>()

  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const request = new Request(
      typeof input === "string" ? new URL(input, window.location.href) : input,
      init,
    )
    request.signal.throwIfAborted()
    requests.push(request)

    const url = new URL(request.url)
    for (const { method, path, respond } of handlers) {
      if (request.method !== method) continue
      const params = matchPath(path, url)
      if (!params) continue

      pending.add(request)
      let abort: (() => void) | undefined
      try {
        const aborted = new Promise<never>((_, reject) => {
          abort = () => {
            // Fetch propagates the AbortSignal's original reason, which need not be an Error.
            // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
            reject(request.signal.reason)
          }
          request.signal.addEventListener("abort", abort, { once: true })
        })
        const response = await Promise.race([
          aborted,
          Promise.resolve().then(() => respond({ request, params })),
        ])
        if (response.type === "error") throw new TypeError("Failed to fetch")
        for (const listener of responseListeners) listener(request)
        return response
      } finally {
        if (abort) request.signal.removeEventListener("abort", abort)
        pending.delete(request)
      }
    }

    const unexpected = `${request.method} ${request.url}`
    unhandled.push(unexpected)
    throw new Error(`Unexpected Hub request: ${unexpected}`)
  })

  vi.stubGlobal("fetch", fetch)
  // A route error boundary must not turn a missing test handler into a passing case.
  onTestFinished(() => expect(unhandled, "Unexpected Hub requests").toEqual([]))
  return {
    requests,
    pending,
    onResponse(listener: (request: Request) => void) {
      responseListeners.add(listener)
    },
    use(...overrides: HubHttpHandler[]) {
      handlers = [...overrides, ...handlers]
    },
    reset() {
      handlers = initial
    },
  }
}

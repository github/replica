// @vitest-environment jsdom
import { beforeEach, expect, it, onTestFinished, vi } from "vitest"

import { getControlsRuntime } from "@utils/prototype-controls/controls.mjs"
import { installControlsBridge } from "./controls"
import { controlsEnvelope } from "@utils/prototype-controls-protocol"

const origin = "http://127.0.0.1:1234"
let dispose: (() => void) | undefined
const globals = globalThis as Record<symbol, unknown>
const runtimeKey = Symbol.for("replica.controls.injected.runtime")
const declaration = {
  version: 1,
  scope: "canvasPage",
  controls: [
    {
      id: "title",
      label: "Title",
      type: "text",
      default: "Default",
      binding: { type: "query", key: "title", mode: "in-place" },
    },
  ],
} as const

beforeEach(() => {
  onTestFinished(() => {
    dispose?.()
    dispose = undefined
    delete globals[runtimeKey]
  })
})

function message(data: object, messageOrigin = origin, source: MessageEventSource = window.parent) {
  window.dispatchEvent(new MessageEvent("message", { origin: messageOrigin, source, data }))
}
function hello(settings: { controlQuery?: string; fromFrameUrl?: boolean } = {}) {
  message({
    protocol: "replica:controls",
    version: 1,
    epoch: "canvas-epoch",
    requestId: "hello",
    type: "hello",
    ...settings,
  })
}
async function setup(definitions: unknown = declaration) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(definitions)))
  vi.spyOn(document, "readyState", "get").mockReturnValue("complete")
  const post = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {})
  dispose = installControlsBridge(origin)
  hello()
  await vi.waitFor(() => expect(post.mock.calls.at(-1)?.[0]).toMatchObject({ type: "reply" }))
  return post
}

it("connects ordinary local JSON bindings and stores settings in the prototype URL", async () => {
  const post = await setup()
  expect(fetch).toHaveBeenCalledOnce()
  expect(fetch).toHaveBeenCalledWith("/controls.replica.json", {
    credentials: "same-origin",
    redirect: "error",
  })
  expect(post.mock.calls.at(-1)?.[0]).toMatchObject({ state: { status: "ready" } })
  const controller = getControlsRuntime().list()[0]!
  message({
    protocol: "replica:controls",
    version: 1,
    epoch: "canvas-epoch",
    requestId: "update",
    type: "command",
    command: {
      operation: "update",
      scope: "canvasPage",
      fingerprint: JSON.stringify(controller.declaration),
      revision: controller.getSnapshot().revision,
      id: "title",
      value: "Changed",
    },
  })
  await vi.waitFor(() => expect(controller.getSnapshot().values.title).toBe("Changed"))
  expect(new URLSearchParams(window.location.search).get("title")).toBe("Changed")
  message({
    protocol: "replica:controls",
    version: 1,
    epoch: "canvas-epoch",
    requestId: "url",
    type: "command",
    command: { operation: "url", scope: "canvasPage", query: 'rc.canvasPage.title="Changed"' },
  })
  await vi.waitFor(() =>
    expect(new URLSearchParams(window.location.search).get("rc.canvasPage.title")).toBe(
      '"Changed"',
    ),
  )
})

it("rejects foreign frames, origins, epochs and stale commands without changing app state", async () => {
  const post = await setup()
  const controller = getControlsRuntime().list()[0]!
  const data = {
    protocol: "replica:controls",
    version: 1,
    epoch: "canvas-epoch",
    requestId: "update",
    type: "command",
    command: {
      operation: "update",
      scope: "canvasPage",
      fingerprint: JSON.stringify(controller.declaration),
      revision: controller.getSnapshot().revision,
      id: "title",
      value: "Foreign",
    },
  }
  message(data, "http://evil.local")
  const frame = document.createElement("iframe")
  document.body.append(frame)
  message(data, origin, frame.contentWindow!)
  message({ ...data, epoch: "old" })
  expect(controller.getSnapshot().values.title).toBe("Default")
  message({ ...data, command: { ...data.command, revision: data.command.revision + 1 } })
  await vi.waitFor(() =>
    expect(JSON.stringify(post.mock.calls.at(-1)?.[0])).toContain("stale command"),
  )
  expect(controller.getSnapshot().values.title).toBe("Default")
  frame.remove()
})

it("adopts defaulted Build URLs and preserves router state without history entries", async () => {
  window.history.replaceState({ router: "startup" }, "", "/?rc=1")
  const post = await setup()
  const length = window.history.length
  hello({ fromFrameUrl: true, controlQuery: 'rc.canvasPage.title="Stale parent"' })
  await vi.waitFor(() =>
    expect(post.mock.calls.at(-1)?.[0]).toMatchObject({ type: "reply", controlQuery: "" }),
  )
  expect(new URLSearchParams(window.location.search).has("rc.canvasPage.title")).toBe(false)
  expect(window.history.state).toEqual({ router: "startup" })
  expect(window.history.length).toBe(length)
})

it("reports invalid and unsupported definitions without manufacturing app-side compatibility", async () => {
  const post = await setup({ ...declaration, version: 99 })
  const reply: unknown = post.mock.calls.at(-1)?.[0]
  expect(reply).toMatchObject({ state: { status: "invalid-config", runtimeAvailable: false } })
  expect(controlsEnvelope(reply)).toBe(true)
  expect(globals[runtimeKey]).toBeUndefined()
  expect(document.body).toBeTruthy()
})

it("reports no Controls for a missing document and does not read old metadata", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Not found", { status: 404 })))
  const post = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {})
  dispose = installControlsBridge(origin)
  hello()
  await vi.waitFor(() =>
    expect(post.mock.calls.at(-1)?.[0]).toMatchObject({
      state: { status: "no-controls", runtimeAvailable: false },
    }),
  )
  expect(fetch).toHaveBeenCalledOnce()
  expect(globals[runtimeKey]).toBeUndefined()
})

it("reports pending then exact live binding errors without editing the app", async () => {
  let deliver!: (response: Response) => void
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise<Response>((resolve) => (deliver = resolve))),
  )
  vi.spyOn(document, "readyState", "get").mockReturnValue("complete")
  const post = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {})
  dispose = installControlsBridge(origin)
  function status(nonce: string, timeoutMs = 0, messageOrigin = origin) {
    message({ type: "replica:controls:status", nonce, timeoutMs }, messageOrigin)
  }
  status("wrong", 0, "http://other.local")
  expect(post).not.toHaveBeenCalled()
  status("pending")
  expect(post).toHaveBeenLastCalledWith(
    {
      type: "replica:controls:status-result",
      nonce: "pending",
      value: { status: "pending", url: window.location.href, error: "", controls: [] },
    },
    origin,
  )
  status("ready", 1000)
  document.body.innerHTML =
    '<div class="duplicate"></div><div class="duplicate"></div><svg id="icon"></svg>'
  deliver(
    Response.json({
      version: 1,
      scope: "runtimeStatusErrors",
      controls: [
        ...["#missing", ".duplicate", "#icon"].map((selector, index) => ({
          id: `style${index}`,
          label: `Style ${index}`,
          type: "text",
          default: "1",
          binding: { type: "style", selector, property: "--value" },
        })),
        {
          id: "api",
          label: "API",
          type: "button",
          binding: { type: "api", object: "replicaUnavailable", action: "act" },
        },
      ],
    }),
  )
  const controls = [
    "The binding target is missing.",
    "The binding target is ambiguous.",
    "The binding target is missing or stale.",
    'The app API "replicaUnavailable" is unavailable.',
  ].map((error, index) => ({
    scope: "runtimeStatusErrors",
    id: index === 3 ? "api" : `style${index}`,
    available: false,
    busy: false,
    visible: true,
    error,
  }))
  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      {
        type: "replica:controls:status-result",
        nonce: "ready",
        value: { status: "ready", url: window.location.href, error: "", controls },
      },
      origin,
    ),
  )
  const before = document.body.innerHTML
  status("read-only")
  expect(document.body.innerHTML).toBe(before)
  document.body.innerHTML = ""
})

it("returns pending on timeout instead of old controls, then no-controls when initialized", async () => {
  vi.useFakeTimers()
  let deliver!: (response: Response) => void
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise<Response>((resolve) => (deliver = resolve))),
  )
  const post = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {})
  dispose = installControlsBridge(origin)
  message({ type: "replica:controls:status", nonce: "timeout", timeoutMs: 200 })
  await vi.advanceTimersByTimeAsync(200)
  expect(post.mock.calls.at(-1)?.[0]).toMatchObject({
    nonce: "timeout",
    value: { status: "pending", controls: [] },
  })
  deliver(new Response("", { status: 404 }))
  await vi.advanceTimersByTimeAsync(0)
  message({ type: "replica:controls:status", nonce: "empty", timeoutMs: 0 })
  expect(post.mock.calls.at(-1)?.[0]).toMatchObject({
    nonce: "empty",
    value: { status: "no-controls" },
  })
})

it("reports busy actions and current route without invoking or replaying actions", async () => {
  const action = vi.fn(() => new Promise<void>(() => {}))
  vi.stubGlobal("runtimeStatusApi", { act: action })
  const post = await setup({
    version: 1,
    scope: "busyStatus",
    controls: [
      {
        id: "act",
        label: "Act",
        type: "button",
        binding: { type: "api", object: "runtimeStatusApi", action: "act" },
      },
    ],
  })
  const controller = getControlsRuntime().list()[0]!
  for (const pathname of ["/first", "/second"]) {
    window.history.replaceState(null, "", pathname)
    message({ type: "replica:controls:status", nonce: pathname, timeoutMs: 0 })
    expect(post.mock.calls.at(-1)?.[0]).toMatchObject({
      value: {
        url: window.location.href,
        controls: [
          {
            scope: "busyStatus",
            id: "act",
            visible: true,
            available: true,
            busy: false,
            error: "",
          },
        ],
      },
    })
  }
  expect(action).not.toHaveBeenCalled()
  let finish!: () => void
  action.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)))
  const running = controller.action("act")
  await vi.waitFor(() => expect(action).toHaveBeenCalledOnce())
  message({ type: "replica:controls:status", nonce: "busy", timeoutMs: 0 })
  expect(post.mock.calls.at(-1)?.[0]).toMatchObject({
    value: {
      status: "ready",
      controls: [
        { scope: "busyStatus", id: "act", visible: true, available: true, busy: true, error: "" },
      ],
    },
  })
  expect(action).toHaveBeenCalledOnce()
  finish()
  await running
})

it("publishes recovery for a late-mounted API to both the panel and status reader", async () => {
  vi.stubGlobal("lateHeaderApi", undefined)
  const post = await setup({
    version: 1,
    scope: "lateHeaderRecovery",
    controls: [
      {
        id: "search",
        label: "Show search",
        type: "boolean",
        default: true,
        binding: {
          type: "api",
          object: "lateHeaderApi",
          read: "read",
          write: "write",
          pollMs: 250,
        },
      },
    ],
  })
  const error = 'The app API "lateHeaderApi" is not an object.'
  expect(post.mock.calls.at(-1)?.[0]).toMatchObject({
    state: { scopes: [{ snapshot: { bindings: { search: { error, available: false } } } }] },
  })
  let visible = true
  vi.stubGlobal("lateHeaderApi", {
    read: () => visible,
    write: (next: boolean) => {
      visible = next
    },
  })
  await vi.waitFor(() =>
    expect(post.mock.calls.at(-1)?.[0]).toMatchObject({
      state: {
        scopes: [{ snapshot: { bindings: { search: { error: "", available: true } } } }],
      },
    }),
  )
  message({ type: "replica:controls:status", nonce: "recovered", timeoutMs: 0 })
  expect(post.mock.calls.at(-1)?.[0]).toMatchObject({
    value: {
      status: "ready",
      controls: [{ id: "search", available: true, error: "" }],
    },
  })
})

it("keeps startup binding discovery pending while a mount effect registers its API", async () => {
  vi.useFakeTimers()
  vi.stubGlobal("startupHeaderApi", undefined)
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      Response.json({
        version: 1,
        scope: "startupHeaderRecovery",
        controls: [
          {
            id: "search",
            label: "Show search",
            type: "boolean",
            default: true,
            binding: {
              type: "api",
              object: "startupHeaderApi",
              read: "read",
              write: "write",
              pollMs: 250,
            },
          },
        ],
      }),
    ),
  )
  vi.spyOn(document, "readyState", "get").mockReturnValue("complete")
  const post = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {})
  dispose = installControlsBridge(origin)
  hello()
  await vi.advanceTimersByTimeAsync(0)
  message({ type: "replica:controls:status", nonce: "starting", timeoutMs: 0 })
  expect(post.mock.calls.at(-1)?.[0]).toMatchObject({
    nonce: "starting",
    value: { status: "pending", controls: [] },
  })
  let value = true
  vi.stubGlobal("startupHeaderApi", {
    read: () => value,
    write: (next: boolean) => {
      value = next
    },
  })
  await vi.advanceTimersByTimeAsync(400)
  message({ type: "replica:controls:status", nonce: "mounted", timeoutMs: 0 })
  expect(post.mock.calls.at(-1)?.[0]).toMatchObject({
    nonce: "mounted",
    value: {
      status: "ready",
      controls: [{ id: "search", available: true, error: "" }],
    },
  })
})

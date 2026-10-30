import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest"

import { PREVIEW_BRIDGE_MESSAGE_SCHEMA } from "@utils/preview-bridge/schemas"

import { createPreviewBridgeTestHarness } from "./create-preview-bridge-test-harness"

const harness = createPreviewBridgeTestHarness()
const { anchor, areaAnchor, bridgeWindow, dispatchMessage, message, postedMessages, renderFrames } =
  harness

beforeEach(() => onTestFinished(harness.close))

describe("installReplicaPreviewBridge()", () => {
  it.each(["static", "fixed", "sticky"])(
    "keeps a pin attached during document scrolling with a %s ancestor",
    async (position) => {
      const { parent, preview, postMessage } = bridgeWindow()
      preview.document.body.innerHTML = `<section style="position: ${position}"><button id="save" aria-label="Save">Save</button></section>`
      const button = preview.document.querySelector("button")!
      let top = 300
      const bounds = vi.spyOn(button, "getBoundingClientRect").mockImplementation(() => ({
        x: 20,
        y: top,
        left: 20,
        top,
        right: 120,
        bottom: top + 32,
        width: 100,
        height: 32,
        toJSON: () => ({}),
      }))
      dispatchMessage(
        preview,
        parent,
        message("replica:bridge:resolve-anchors", {
          replace: true,
          anchors: [{ commentId: 1, originBuild: true, anchor: anchor() }],
        }),
      )
      await renderFrames(preview)
      bounds.mockClear()
      Object.defineProperty(preview, "scrollY", { configurable: true, value: 120 })
      if (position === "static") top -= 120
      preview.document.dispatchEvent(new preview.Event("scroll"))
      expect(postedMessages(postMessage).at(-1)).toMatchObject({
        payload: { results: [{ point: { x: 70, y: position === "static" ? 196 : 316 } }] },
      })
      if (position === "static") expect(bounds).not.toHaveBeenCalled()
      else expect(bounds).toHaveBeenCalled()

      top = 140
      preview.document.querySelector("section")!.dispatchEvent(new preview.Event("scroll"))
      await renderFrames(preview)
      expect(postedMessages(postMessage).at(-1)).toMatchObject({
        payload: { results: [{ point: { x: 70, y: 156 } }] },
      })
      top = 100
      preview.dispatchEvent(new preview.Event("resize"))
      await renderFrames(preview)
      expect(postedMessages(postMessage).at(-1)).toMatchObject({
        payload: { results: [{ point: { x: 70, y: 116 } }] },
      })
    },
  )

  it("forwards Escape without confusing conversation dismissal with selection cancellation", async () => {
    const { parent, preview, postMessage } = bridgeWindow()
    preview.dispatchEvent(new preview.KeyboardEvent("keydown", { key: "Escape" }))
    expect(postMessage).not.toHaveBeenCalled()
    await new Promise((resolve) => preview.setTimeout(resolve, 0))
    expect(postedMessages(postMessage).at(-1)).toMatchObject({
      type: "replica:bridge:conversation-dismiss-requested",
      payload: {},
    })
    expect(
      PREVIEW_BRIDGE_MESSAGE_SCHEMA.safeParse(postedMessages(postMessage).at(-1)).success,
    ).toBe(true)
    dispatchMessage(preview, parent, message("replica:bridge:select-element"))
    postMessage.mockClear()
    preview.document.dispatchEvent(
      new preview.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    )
    await new Promise((resolve) => preview.setTimeout(resolve, 0))
    expect(postedMessages(postMessage).map((entry) => (entry as { type: string }).type)).toEqual([
      "replica:bridge:selection-cancelled",
    ])
  })

  it("leaves Escape consumed by the prototype or its menus and dialogs alone", async () => {
    const { preview, postMessage } = bridgeWindow()
    preview.document.body.innerHTML = `
      <input id="search">
      <div role="dialog"><button>Close dialog</button></div>
      <div role="menu"><button>Close menu</button></div>
    `
    const search = preview.document.querySelector("input")!
    search.addEventListener("keydown", (event) => event.preventDefault())
    for (const target of preview.document.querySelectorAll("input, button")) {
      target.dispatchEvent(
        new preview.KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      )
    }
    preview.dispatchEvent(
      new preview.KeyboardEvent("keydown", { key: "Escape", isComposing: true }),
    )
    await new Promise((resolve) => preview.setTimeout(resolve, 0))
    expect(postMessage).not.toHaveBeenCalled()
  })

  it.each(["prevent-default", "element", "area"])(
    "does not forward Escape after a later window listener handles it with %s",
    async (action) => {
      const { parent, preview, postMessage } = bridgeWindow()
      preview.addEventListener("keydown", (event) => {
        if (action === "prevent-default") event.preventDefault()
        else dispatchMessage(preview, parent, message(`replica:bridge:select-${action}`))
      })
      preview.dispatchEvent(
        new preview.KeyboardEvent("keydown", { key: "Escape", cancelable: true }),
      )
      await new Promise((resolve) => preview.setTimeout(resolve, 0))
      expect(postedMessages(postMessage)).not.toContainEqual(
        expect.objectContaining({ type: "replica:bridge:conversation-dismiss-requested" }),
      )
    },
  )

  it("keeps control parameters separate from review routes and their size limit", () => {
    const { parent, preview, postMessage } = bridgeWindow()
    preview.history.replaceState(
      {},
      "",
      `/settings?tab=profile&rc=1&rc.page.title=${"x".repeat(3000)}#section`,
    )
    dispatchMessage(preview, parent, message("replica:bridge:request-ready"))
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "replica:bridge:ready",
        payload: { route: { pathname: "/settings", search: "?tab=profile", hash: "#section" } },
      }),
      "http://replica.localhost:19500",
    )
  })

  it("keeps default-branch previews browse-only without consuming application shortcuts", () => {
    const { parent, preview, postMessage } = bridgeWindow({ reviewEnabled: false })
    const applicationShortcut = vi.fn()
    preview.addEventListener("keydown", applicationShortcut)
    for (const [key, shiftKey] of [
      ["c", false],
      ["h", false],
      ["C", true],
    ] as const) {
      const event = new preview.KeyboardEvent("keydown", { key, shiftKey, cancelable: true })
      preview.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
    }
    expect(applicationShortcut).toHaveBeenCalledTimes(3)
    expect(postMessage).not.toHaveBeenCalled()

    dispatchMessage(preview, parent, message("replica:bridge:select-element"))
    dispatchMessage(preview, parent, message("replica:bridge:select-area"))
    dispatchMessage(
      preview,
      parent,
      message("replica:bridge:resolve-anchors", {
        replace: true,
        anchors: [{ commentId: 1, originBuild: true, anchor: anchor() }],
      }),
    )
    expect(preview.document.documentElement.style.cursor).toBe("")
    expect(preview.document.querySelector("[data-replica-bridge]")).toBeNull()
    expect(postMessage).not.toHaveBeenCalled()

    dispatchMessage(preview, parent, message("replica:bridge:set-theme", { theme: "dark" }))
    expect(preview.document.documentElement.dataset.replicaTheme).toBe("dark")
    dispatchMessage(preview, parent, message("replica:bridge:request-ready"))
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "replica:bridge:ready",
        payload: { route: { pathname: "/", search: "", hash: "" } },
      }),
      "http://replica.localhost:19500",
    )
    preview.history.pushState({}, "", "/settings?tab=profile#name")
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "replica:bridge:route-changed",
        payload: { route: { pathname: "/settings", search: "?tab=profile", hash: "#name" } },
      }),
      "http://replica.localhost:19500",
    )
  })

  it("applies only validated Hub theme changes to the preview document", () => {
    const { parent, preview } = bridgeWindow()
    const changes: string[] = []
    preview.addEventListener("replica:theme-change", (event) => {
      changes.push((event as CustomEvent<{ theme: string }>).detail.theme)
    })

    dispatchMessage(
      preview,
      parent,
      message("replica:bridge:set-theme", { theme: "dark" }),
      "https://example.test",
    )
    dispatchMessage(preview, parent, message("replica:bridge:set-theme", { theme: "automatic" }))
    expect(preview.document.documentElement.style.colorScheme).toBe("")

    dispatchMessage(preview, parent, message("replica:bridge:set-theme", { theme: "dark" }))
    expect(preview.document.documentElement.style.colorScheme).toBe("dark")
    expect(preview.document.documentElement.dataset.replicaTheme).toBe("dark")
    dispatchMessage(preview, parent, message("replica:bridge:set-theme", { theme: "light" }))
    expect(preview.document.documentElement.style.colorScheme).toBe("light")
    expect(changes).toEqual(["dark", "light"])
  })

  it("restores a native section without invoking router wrappers or navigation events", async () => {
    const { parent, preview, postMessage } = bridgeWindow()
    const state = { application: { selected: "stations" }, position: 3 }
    preview.history.replaceState(state, "", "/guide?view=full")
    const target = preview.document.createElement("section")
    target.id = "stations"
    const scrollIntoView = vi.fn(() => {
      expect(postedMessages(postMessage)).not.toContainEqual(
        expect.objectContaining({ type: "replica:bridge:ready" }),
      )
    })
    target.scrollIntoView = scrollIntoView
    preview.document.body.append(target)
    const routerReplaceState = vi.fn(() => {
      throw new Error("The old router must not reinterpret the fragment")
    })
    preview.history.replaceState = routerReplaceState
    preview.History.prototype.replaceState = routerReplaceState
    const navigation = vi.fn()
    preview.addEventListener("hashchange", navigation)
    preview.addEventListener("popstate", navigation)
    postMessage.mockClear()

    dispatchMessage(preview, parent, {
      ...message("replica:bridge:restore-fragment", {
        route: { pathname: "/guide", search: "?view=full", hash: "#stations" },
      }),
      requestId: "restore-stations",
    })
    expect(preview.location.hash).toBe("")
    expect(postMessage).not.toHaveBeenCalled()
    await renderFrames(preview)

    expect(preview.location.href).toBe(
      "http://b1.preview.replica.localhost:19500/guide?view=full#stations",
    )
    expect(preview.history.state).toBe(state)
    expect(routerReplaceState).not.toHaveBeenCalled()
    expect(navigation).not.toHaveBeenCalled()
    expect(scrollIntoView).toHaveBeenCalledOnce()
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: "start",
      inline: "nearest",
      behavior: "instant",
    })
    expect(postedMessages(postMessage)).toEqual([
      expect.objectContaining({
        type: "replica:bridge:route-changed",
        payload: { route: { pathname: "/guide", search: "?view=full", hash: "#stations" } },
      }),
      {
        protocolVersion: 1,
        type: "replica:bridge:ready",
        requestId: "restore-stations",
        payload: { route: { pathname: "/guide", search: "?view=full", hash: "#stations" } },
      },
    ])
  })

  it("restores native fragments in read-only Browse mode", async () => {
    const { parent, preview, postMessage } = bridgeWindow({ reviewEnabled: false })
    const target = preview.document.createElement("section")
    target.id = "welcome"
    const scrollIntoView = vi.fn()
    target.scrollIntoView = scrollIntoView
    preview.document.body.append(target)

    dispatchMessage(
      preview,
      parent,
      message("replica:bridge:restore-fragment", {
        route: { pathname: "/", search: "", hash: "#welcome" },
      }),
    )
    await renderFrames(preview)

    expect(scrollIntoView).toHaveBeenCalledOnce()
    expect(preview.document.querySelector("[data-replica-bridge]")).toBeNull()
    expect(postedMessages(postMessage).at(-1)).toMatchObject({
      type: "replica:bridge:ready",
      requestId: "request-1",
      payload: { route: { pathname: "/", search: "", hash: "#welcome" } },
    })
  })

  it.each([
    { attribute: "id", name: "café [stations]", hash: "#caf%C3%A9%20%5Bstations%5D" },
    { attribute: "name", name: 'old "contents"', hash: "#old%20%22contents%22" },
    { attribute: "id", name: "100%welcome", hash: "#100%welcome" },
  ])("resolves $attribute targets without using the fragment as a selector", async (fragment) => {
    const { parent, preview, postMessage } = bridgeWindow()
    const target = preview.document.createElement("a")
    target.setAttribute(fragment.attribute, fragment.name)
    const scrollIntoView = vi.fn()
    target.scrollIntoView = scrollIntoView
    preview.document.body.append(target)

    dispatchMessage(
      preview,
      parent,
      message("replica:bridge:restore-fragment", {
        route: { pathname: "/", search: "", hash: fragment.hash },
      }),
    )
    await renderFrames(preview)

    expect(scrollIntoView).toHaveBeenCalledOnce()
    expect(preview.location.hash).toBe(fragment.hash)
    expect(postedMessages(postMessage).at(-1)).toMatchObject({
      type: "replica:bridge:ready",
      payload: { route: { pathname: "/", search: "", hash: fragment.hash } },
    })
  })

  it("prefers a DOM id over a named anchor with the same fragment", async () => {
    const { parent, preview } = bridgeWindow()
    const named = preview.document.createElement("a")
    named.setAttribute("name", "contents")
    const scrollNamed = vi.fn()
    named.scrollIntoView = scrollNamed
    const target = preview.document.createElement("section")
    target.id = "contents"
    const scrollTarget = vi.fn()
    target.scrollIntoView = scrollTarget
    preview.document.body.append(named, target)

    dispatchMessage(
      preview,
      parent,
      message("replica:bridge:restore-fragment", {
        route: { pathname: "/", search: "", hash: "#contents" },
      }),
    )
    await renderFrames(preview)

    expect(scrollTarget).toHaveBeenCalledOnce()
    expect(scrollNamed).not.toHaveBeenCalled()
  })

  it("lets the initial application frame render before replaying the fragment", async () => {
    const { parent, preview, postMessage } = bridgeWindow()
    const target = preview.document.createElement("section")
    target.id = "stations"
    const scrollIntoView = vi.fn()
    target.scrollIntoView = scrollIntoView
    dispatchMessage(preview, parent, message("replica:bridge:request-ready"))
    expect(postedMessages(postMessage).at(-1)).toMatchObject({
      type: "replica:bridge:ready",
      payload: { route: { pathname: "/", search: "", hash: "" } },
    })
    postMessage.mockClear()
    dispatchMessage(
      preview,
      parent,
      message("replica:bridge:restore-fragment", {
        route: { pathname: "/", search: "", hash: "#stations" },
      }),
    )
    preview.requestAnimationFrame(() => preview.document.body.append(target))
    expect(preview.document.getElementById("stations")).toBeNull()
    expect(preview.location.hash).toBe("")
    expect(postMessage).not.toHaveBeenCalled()
    await renderFrames(preview)

    expect(scrollIntoView).toHaveBeenCalledOnce()
    expect(postedMessages(postMessage).at(-1)).toMatchObject({
      type: "replica:bridge:ready",
      requestId: "request-1",
      payload: { route: { pathname: "/", search: "", hash: "#stations" } },
    })
  })

  it("rejects untrusted, malformed, unbounded, and mismatched fragment requests", async () => {
    const { parent, preview, postMessage } = bridgeWindow()
    const target = preview.document.createElement("section")
    target.id = "stations"
    const scrollIntoView = vi.fn()
    target.scrollIntoView = scrollIntoView
    preview.document.body.append(target)
    const route = { pathname: "/", search: "", hash: "#stations" }
    const restore = message("replica:bridge:restore-fragment", { route })
    dispatchMessage(preview, parent, restore, "https://example.test")
    dispatchMessage(preview, preview, restore)
    for (const invalid of [
      { ...restore, protocolVersion: 2 },
      { ...restore, requestId: "" },
      { ...restore, requestId: "r".repeat(129) },
      { ...restore, extra: true },
      { ...restore, payload: { route, extra: true } },
      ...[
        null,
        { ...route, extra: true },
        { ...route, pathname: "stations" },
        { ...route, pathname: "//example.test/" },
        { ...route, pathname: "/redirected" },
        { ...route, search: "?other" },
        { ...route, hash: "" },
        { ...route, hash: "#" },
        { ...route, hash: "stations" },
        { ...route, hash: "# " },
        { ...route, hash: "#\nstations" },
        { ...route, hash: `#${"é".repeat(512)}` },
      ].map((invalidRoute) => ({ ...restore, payload: { route: invalidRoute } })),
    ]) {
      dispatchMessage(preview, parent, invalid)
    }
    await renderFrames(preview)

    expect(preview.location.pathname).toBe("/")
    expect(preview.location.search).toBe("")
    expect(preview.location.hash).toBe("")
    expect(scrollIntoView).not.toHaveBeenCalled()
    expect(postMessage).not.toHaveBeenCalled()
  })

  it.each(["#/stations", "#!stations", "#!/stations"])(
    "leaves the legitimate hash route %s to the application",
    async (hash) => {
      const { parent, preview, postMessage } = bridgeWindow()
      const target = preview.document.createElement("section")
      target.id = hash.slice(1)
      const scrollIntoView = vi.fn()
      target.scrollIntoView = scrollIntoView
      preview.document.body.append(target)
      dispatchMessage(
        preview,
        parent,
        message("replica:bridge:restore-fragment", {
          route: { pathname: "/", search: "", hash },
        }),
      )
      await renderFrames(preview)
      expect(preview.location.hash).toBe("")
      expect(postMessage).not.toHaveBeenCalled()

      const navigated = new Promise<void>((resolve) =>
        preview.addEventListener("hashchange", () => resolve(), { once: true }),
      )
      preview.location.hash = hash
      await navigated

      expect(preview.location.hash).toBe(hash)
      expect(scrollIntoView).not.toHaveBeenCalled()
      expect(postedMessages(postMessage).at(-1)).toMatchObject({
        type: "replica:bridge:route-changed",
        payload: { route: { pathname: "/", search: "", hash } },
      })
    },
  )

  it.each(["/redirected", "/?redirected=true"])(
    "does not scroll or change a page redirected to %s during initial rendering",
    async (redirect) => {
      const { parent, preview, postMessage } = bridgeWindow()
      const target = preview.document.createElement("section")
      target.id = "stations"
      const scrollIntoView = vi.fn()
      target.scrollIntoView = scrollIntoView
      preview.document.body.append(target)
      dispatchMessage(
        preview,
        parent,
        message("replica:bridge:restore-fragment", {
          route: { pathname: "/", search: "", hash: "#stations" },
        }),
      )
      preview.requestAnimationFrame(() => preview.history.replaceState({}, "", redirect))
      await renderFrames(preview)

      expect(preview.location.href).toBe(`http://b1.preview.replica.localhost:19500${redirect}`)
      expect(scrollIntoView).not.toHaveBeenCalled()
      expect(postedMessages(postMessage)).not.toContainEqual(
        expect.objectContaining({ type: "replica:bridge:ready" }),
      )
    },
  )

  it("navigates absent targets normally and acknowledges the hash router's settled URL", async () => {
    const { parent, preview, postMessage } = bridgeWindow()
    const applicationRoute = vi.fn(() => {
      expect(preview.location.hash).toBe("#contents")
      preview.requestAnimationFrame(() => {
        preview.history.replaceState({ routed: true }, "", "/#contents-loaded")
      })
    })
    preview.addEventListener("hashchange", applicationRoute)
    const navigated = new Promise<void>((resolve) =>
      preview.addEventListener("hashchange", () => resolve(), { once: true }),
    )

    dispatchMessage(preview, parent, {
      ...message("replica:bridge:restore-fragment", {
        route: { pathname: "/", search: "", hash: "#contents" },
      }),
      requestId: "restore-route",
    })
    await navigated
    expect(postedMessages(postMessage)).not.toContainEqual(
      expect.objectContaining({ type: "replica:bridge:ready" }),
    )
    await renderFrames(preview)

    expect(applicationRoute).toHaveBeenCalledOnce()
    expect(preview.location.hash).toBe("#contents-loaded")
    expect(preview.history.state).toEqual({ routed: true })
    expect(postedMessages(postMessage)).toContainEqual(
      expect.objectContaining({
        type: "replica:bridge:route-changed",
        payload: { route: { pathname: "/", search: "", hash: "#contents" } },
      }),
    )
    expect(postedMessages(postMessage).at(-1)).toMatchObject({
      type: "replica:bridge:ready",
      requestId: "restore-route",
      payload: { route: { pathname: "/", search: "", hash: "#contents-loaded" } },
    })

    const target = preview.document.createElement("section")
    target.id = "contents"
    const scrollIntoView = vi.fn()
    target.scrollIntoView = scrollIntoView
    preview.document.body.append(target)
    await renderFrames(preview)

    expect(scrollIntoView).not.toHaveBeenCalled()
    expect(preview.location.hash).toBe("#contents-loaded")
    expect(preview.history.state).toEqual({ routed: true })
  })

  it("retains an absent fragment in the URL and does not treat named inputs as anchors", async () => {
    const { parent, preview, postMessage } = bridgeWindow()
    const input = preview.document.createElement("input")
    input.name = "contents"
    const scrollIntoView = vi.fn()
    input.scrollIntoView = scrollIntoView
    preview.document.body.append(input)
    const navigated = new Promise<void>((resolve) =>
      preview.addEventListener("hashchange", () => resolve(), { once: true }),
    )

    dispatchMessage(
      preview,
      parent,
      message("replica:bridge:restore-fragment", {
        route: { pathname: "/", search: "", hash: "#contents" },
      }),
    )
    await navigated
    await renderFrames(preview)

    expect(scrollIntoView).not.toHaveBeenCalled()
    expect(preview.location.hash).toBe("#contents")
    expect(postedMessages(postMessage).at(-1)).toMatchObject({
      type: "replica:bridge:ready",
      requestId: "request-1",
      payload: { route: { pathname: "/", search: "", hash: "#contents" } },
    })
  })

  it.each([true, false])(
    "acknowledges promptly and scrolls a later target once with reviewEnabled=%s",
    async (reviewEnabled) => {
      const { parent, preview, postMessage } = bridgeWindow({ reviewEnabled })
      const navigated = new Promise<void>((resolve) =>
        preview.addEventListener("hashchange", () => resolve(), { once: true }),
      )
      dispatchMessage(
        preview,
        parent,
        message("replica:bridge:restore-fragment", {
          route: { pathname: "/", search: "", hash: "#stations" },
        }),
      )
      await navigated
      await renderFrames(preview)
      expect(preview.document.getElementById("stations")).toBeNull()
      expect(postedMessages(postMessage).at(-1)).toMatchObject({
        type: "replica:bridge:ready",
        requestId: "request-1",
        payload: { route: { pathname: "/", search: "", hash: "#stations" } },
      })

      const state = { loaded: true }
      preview.history.replaceState(state, "", "/#stations")
      const replaceState = vi.spyOn(preview.history, "replaceState")
      const navigation = vi.fn()
      preview.addEventListener("hashchange", navigation)
      preview.addEventListener("popstate", navigation)
      postMessage.mockClear()
      const target = preview.document.createElement("section")
      target.id = "stations"
      const scrollIntoView = vi.fn()
      target.scrollIntoView = scrollIntoView
      preview.document.body.append(target)
      await renderFrames(preview)

      expect(scrollIntoView).toHaveBeenCalledOnce()
      expect(scrollIntoView).toHaveBeenCalledWith({
        block: "start",
        inline: "nearest",
        behavior: "instant",
      })
      expect(preview.location.hash).toBe("#stations")
      expect(preview.history.state).toBe(state)
      expect(replaceState).not.toHaveBeenCalled()
      expect(navigation).not.toHaveBeenCalled()
      expect(postMessage).not.toHaveBeenCalled()

      target.remove()
      preview.document.body.append(target)
      await renderFrames(preview)
      expect(scrollIntoView).toHaveBeenCalledOnce()
    },
  )

  it.each(["/away#stations", "/?view=other#stations", "/#welcome"])(
    "cancels a late target on navigation to %s even if the original route returns",
    async (destination) => {
      const { parent, preview, postMessage } = bridgeWindow()
      const navigated = new Promise<void>((resolve) =>
        preview.addEventListener("hashchange", () => resolve(), { once: true }),
      )
      dispatchMessage(
        preview,
        parent,
        message("replica:bridge:restore-fragment", {
          route: { pathname: "/", search: "", hash: "#stations" },
        }),
      )
      await navigated
      await renderFrames(preview)
      expect(postedMessages(postMessage).at(-1)).toMatchObject({
        type: "replica:bridge:ready",
      })

      if (destination === "/#welcome") {
        const changedHash = new Promise<void>((resolve) =>
          preview.addEventListener("hashchange", () => resolve(), { once: true }),
        )
        preview.location.hash = "#welcome"
        await changedHash
      } else {
        preview.history.pushState({}, "", destination)
      }
      preview.history.replaceState({}, "", "/#stations")
      postMessage.mockClear()
      const target = preview.document.createElement("section")
      target.id = "stations"
      const scrollIntoView = vi.fn()
      target.scrollIntoView = scrollIntoView
      preview.document.body.append(target)
      await renderFrames(preview)

      expect(scrollIntoView).not.toHaveBeenCalled()
      expect(preview.location.hash).toBe("#stations")
      expect(postMessage).not.toHaveBeenCalled()
    },
  )

  it("retains only the latest pending fragment when restore requests are superseded", async () => {
    const { parent, preview, postMessage } = bridgeWindow()
    for (const hash of ["#stations", "#welcome"]) {
      const navigated = new Promise<void>((resolve) =>
        preview.addEventListener("hashchange", () => resolve(), { once: true }),
      )
      dispatchMessage(preview, parent, {
        ...message("replica:bridge:restore-fragment", {
          route: { pathname: "/", search: "", hash },
        }),
        requestId: `restore-${hash.slice(1)}`,
      })
      await navigated
      await renderFrames(preview)
      expect(postedMessages(postMessage).at(-1)).toMatchObject({
        type: "replica:bridge:ready",
        requestId: `restore-${hash.slice(1)}`,
      })
    }
    const stations = preview.document.createElement("section")
    stations.id = "stations"
    const scrollStations = vi.fn()
    stations.scrollIntoView = scrollStations
    const welcome = preview.document.createElement("section")
    welcome.id = "welcome"
    const scrollWelcome = vi.fn()
    welcome.scrollIntoView = scrollWelcome
    preview.document.body.append(stations, welcome)
    await renderFrames(preview)

    expect(scrollStations).not.toHaveBeenCalled()
    expect(scrollWelcome).toHaveBeenCalledOnce()
    expect(preview.location.hash).toBe("#welcome")
    preview.history.replaceState({}, "", "/#stations")
    stations.remove()
    preview.document.body.append(stations)
    await renderFrames(preview)
    expect(scrollStations).not.toHaveBeenCalled()
  })

  it.each(["queued", "navigated"])(
    "ignores superseded restore work and ACKs while the first request is %s",
    async (stage) => {
      const { parent, preview, postMessage } = bridgeWindow()
      const welcome = preview.document.createElement("section")
      welcome.id = "welcome"
      const scrollWelcome = vi.fn()
      welcome.scrollIntoView = scrollWelcome
      preview.document.body.append(welcome)
      const navigated =
        stage === "navigated"
          ? new Promise<void>((resolve) =>
              preview.addEventListener("hashchange", () => resolve(), { once: true }),
            )
          : null
      dispatchMessage(preview, parent, {
        ...message("replica:bridge:restore-fragment", {
          route: { pathname: "/", search: "", hash: "#stations" },
        }),
        requestId: "restore-stations",
      })
      if (navigated) await navigated
      dispatchMessage(preview, parent, {
        ...message("replica:bridge:restore-fragment", {
          route: { pathname: "/", search: "", hash: "#welcome" },
        }),
        requestId: "restore-welcome",
      })
      const stations = preview.document.createElement("section")
      stations.id = "stations"
      const scrollStations = vi.fn()
      stations.scrollIntoView = scrollStations
      preview.document.body.append(stations)
      await renderFrames(preview)

      expect(scrollStations).not.toHaveBeenCalled()
      expect(scrollWelcome).toHaveBeenCalledOnce()
      expect(preview.location.hash).toBe("#welcome")
      expect(postedMessages(postMessage)).not.toContainEqual(
        expect.objectContaining({
          type: "replica:bridge:ready",
          requestId: "restore-stations",
        }),
      )
      expect(postedMessages(postMessage).at(-1)).toMatchObject({
        type: "replica:bridge:ready",
        requestId: "restore-welcome",
        payload: { route: { pathname: "/", search: "", hash: "#welcome" } },
      })
    },
  )

  function pointerEvent(
    preview: ReturnType<typeof bridgeWindow>["preview"],
    type: string,
    clientX: number,
    clientY: number,
    shiftKey = false,
  ) {
    const event = new preview.MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX,
      clientY,
      shiftKey,
    })
    Object.defineProperty(event, "pointerId", { value: 1 })
    return event
  }

  it("rejects commands with the wrong origin, source, version, request ID, type, or payload", () => {
    const { parent, postMessage, preview } = bridgeWindow()
    const select = message("replica:bridge:select-element")

    dispatchMessage(preview, parent, select, "https://example.test")
    dispatchMessage(preview, preview, select)
    dispatchMessage(preview, parent, { ...select, protocolVersion: 2 })
    dispatchMessage(preview, parent, { ...select, requestId: "" })
    dispatchMessage(preview, parent, { ...select, type: "replica:bridge:unknown" })
    dispatchMessage(preview, parent, { ...select, payload: { extra: true } })

    expect(preview.document.documentElement.style.cursor).toBe("")
    expect(postMessage).not.toHaveBeenCalled()
  })

  it("selects one element, limits saved details, and restores styles on Escape", () => {
    const { parent, postMessage, preview } = bridgeWindow()
    const button = preview.document.createElement("button")
    button.id = "save"
    button.setAttribute("aria-label", "Save")
    button.textContent = "Save changes"
    button.getBoundingClientRect = () => ({
      bottom: 62,
      height: 32,
      left: 20,
      right: 120,
      top: 30,
      width: 100,
      x: 20,
      y: 30,
      toJSON: () => ({}),
    })
    preview.document.body.append(button)

    dispatchMessage(preview, parent, message("replica:bridge:select-element"))
    expect(preview.document.documentElement.style.cursor).toBe("crosshair")
    button.dispatchEvent(
      new preview.MouseEvent("pointermove", {
        bubbles: true,
        clientX: 45,
        clientY: 46,
      }),
    )
    const highlight = preview.document.querySelector<HTMLElement>(
      "[data-replica-bridge='highlight']",
    )
    expect(highlight?.style.opacity).toBe("1")
    expect(highlight?.style.transition).toBe("opacity 200ms ease-out")

    button.dispatchEvent(
      new preview.MouseEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        clientX: 45,
        clientY: 46,
      }),
    )

    const selected = postedMessages(postMessage).at(-1)
    expect(selected).toMatchObject({
      protocolVersion: 1,
      requestId: "request-1",
      type: "replica:bridge:element-selected",
      payload: {
        anchor: {
          selector: "#save",
          accessibleName: "Save",
          tagName: "button",
          elementOffset: { x: 0.25, y: 0.5 },
        },
      },
    })
    expect(preview.document.documentElement.style.cursor).toBe("")
    expect(highlight?.style.opacity).toBe("0")

    postMessage.mockClear()
    preview.document.dispatchEvent(
      new preview.KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "h" }),
    )
    expect(postMessage).not.toHaveBeenCalled()

    preview.document.documentElement.style.cursor = "wait"
    dispatchMessage(preview, parent, message("replica:bridge:select-element"))
    preview.document.dispatchEvent(
      new preview.KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" }),
    )

    expect(postedMessages(postMessage).at(-1)).toMatchObject({
      type: "replica:bridge:selection-cancelled",
      requestId: "request-1",
    })
    expect(preview.document.documentElement.style.cursor).toBe("wait")
  })

  it("draws and clears one bounded area with sampled element context", () => {
    const { parent, postMessage, preview } = bridgeWindow()
    const button = preview.document.createElement("button")
    button.id = "save"
    button.setAttribute("aria-label", "Save")
    button.textContent = "Save changes"
    button.getBoundingClientRect = () => ({
      bottom: 72,
      height: 32,
      left: 20,
      right: 120,
      top: 40,
      width: 100,
      x: 20,
      y: 40,
      toJSON: () => ({}),
    })
    preview.document.body.append(button)
    Object.defineProperty(preview.document, "elementsFromPoint", {
      value: () => [button],
    })

    dispatchMessage(preview, parent, message("replica:bridge:select-area"))
    button.dispatchEvent(pointerEvent(preview, "pointerdown", 20, 40))
    button.dispatchEvent(pointerEvent(preview, "pointermove", 80, 70))
    button.dispatchEvent(pointerEvent(preview, "pointerup", 120, 100))

    expect(postedMessages(postMessage).at(-1)).toMatchObject({
      type: "replica:bridge:area-selected",
      payload: {
        anchor: {
          schemaVersion: 1,
          kind: "area",
          path: [
            { x: 0, y: 0 },
            { x: 0.6, y: 0.5 },
            { x: 1, y: 1 },
          ],
          rect: { x: 20, y: 40, width: 100, height: 60 },
          elements: [
            {
              selector: "#save",
              accessibleName: "Save",
              tagName: "button",
              textExcerpt: "Save changes",
            },
          ],
        },
      },
    })
    const outline = preview.document.querySelector<SVGElement>(
      "[data-replica-bridge='area-highlight']",
    )
    expect(outline?.style.opacity).toBe("1")

    dispatchMessage(preview, parent, message("replica:bridge:clear-selection"))

    expect(outline?.style.opacity).toBe("0")
  })

  it("requests element selection with C and area selection with H", () => {
    const { postMessage, preview } = bridgeWindow()
    const button = preview.document.createElement("button")
    const input = preview.document.createElement("input")
    preview.document.body.append(button)

    preview.document.dispatchEvent(
      new preview.KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "h" }),
    )
    expect(postedMessages(postMessage).at(-1)).toMatchObject({
      type: "replica:bridge:area-selection-requested",
    })

    postMessage.mockClear()
    preview.document.dispatchEvent(
      new preview.KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "c" }),
    )
    expect(postedMessages(postMessage).at(-1)).toMatchObject({
      type: "replica:bridge:element-selection-requested",
    })

    postMessage.mockClear()
    preview.document.dispatchEvent(
      new preview.KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "C",
        shiftKey: true,
      }),
    )
    expect(postedMessages(postMessage).at(-1)).toMatchObject({
      type: "replica:bridge:sidebar-toggle-requested",
    })

    postMessage.mockClear()
    preview.document.dispatchEvent(
      new preview.KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "H",
        shiftKey: true,
      }),
    )
    expect(postMessage).not.toHaveBeenCalled()

    postMessage.mockClear()
    input.dispatchEvent(
      new preview.KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "h" }),
    )
    input.dispatchEvent(
      new preview.KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "c" }),
    )
    input.dispatchEvent(
      new preview.KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "C",
        shiftKey: true,
      }),
    )
    expect(postMessage).not.toHaveBeenCalled()
  })

  it("rejects an accidental area tap", () => {
    const { parent, postMessage, preview } = bridgeWindow()
    const button = preview.document.createElement("button")
    preview.document.body.append(button)

    dispatchMessage(preview, parent, message("replica:bridge:select-area"))
    button.dispatchEvent(pointerEvent(preview, "pointerdown", 20, 40))
    button.dispatchEvent(pointerEvent(preview, "pointerup", 22, 42))

    expect(postedMessages(postMessage).at(-1)).toMatchObject({
      type: "replica:bridge:selection-failed",
      payload: { reason: "area-too-small" },
    })
  })

  it("bounds freehand paths and cleans closed shapes when Shift is held", () => {
    const { parent, postMessage, preview } = bridgeWindow()
    const surface = preview.document.createElement("div")
    preview.document.body.append(surface)
    Object.defineProperty(preview.document, "elementsFromPoint", { value: () => [] })

    dispatchMessage(preview, parent, message("replica:bridge:select-area"))
    surface.dispatchEvent(pointerEvent(preview, "pointerdown", 10, 50))
    for (let index = 1; index < 200; index += 1) {
      surface.dispatchEvent(
        pointerEvent(preview, "pointermove", 10 + index, 50 + Math.sin(index) * 10),
      )
    }
    surface.dispatchEvent(pointerEvent(preview, "pointerup", 210, 50))

    const freehandMessage = PREVIEW_BRIDGE_MESSAGE_SCHEMA.parse(postedMessages(postMessage).at(-1))
    expect(freehandMessage).toMatchObject({ type: "replica:bridge:area-selected" })
    if (freehandMessage.type !== "replica:bridge:area-selected") {
      throw new Error("Expected an area selection")
    }
    expect(freehandMessage.payload.anchor.path).toHaveLength(160)

    dispatchMessage(preview, parent, message("replica:bridge:clear-selection"))
    dispatchMessage(preview, parent, message("replica:bridge:select-area"))
    surface.dispatchEvent(pointerEvent(preview, "pointerdown", 10, 10))
    surface.dispatchEvent(pointerEvent(preview, "pointermove", 60, 10, true))
    surface.dispatchEvent(pointerEvent(preview, "pointermove", 110, 10, true))
    surface.dispatchEvent(pointerEvent(preview, "pointermove", 110, 35, true))
    surface.dispatchEvent(pointerEvent(preview, "pointermove", 110, 60, true))
    surface.dispatchEvent(pointerEvent(preview, "pointermove", 60, 60, true))
    surface.dispatchEvent(pointerEvent(preview, "pointermove", 10, 60, true))
    surface.dispatchEvent(pointerEvent(preview, "pointermove", 10, 35, true))
    surface.dispatchEvent(pointerEvent(preview, "pointerup", 10, 10, true))

    expect(postedMessages(postMessage).at(-1)).toMatchObject({
      type: "replica:bridge:area-selected",
      payload: {
        anchor: {
          path: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 1, y: 1 },
            { x: 0, y: 1 },
            { x: 0, y: 0 },
          ],
        },
      },
    })
  })

  it("reports pushState, replaceState, popstate, and hashchange routes", () => {
    const { postMessage, preview } = bridgeWindow()

    preview.history.pushState({}, "", "/settings")
    preview.history.replaceState({}, "", "/settings?tab=profile")
    preview.dispatchEvent(new preview.PopStateEvent("popstate"))
    preview.dispatchEvent(new preview.HashChangeEvent("hashchange"))

    const routeMessages = postedMessages(postMessage).filter(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        "type" in entry &&
        entry.type === "replica:bridge:route-changed",
    )
    expect(routeMessages).toHaveLength(4)
    expect(routeMessages.at(-1)).toMatchObject({
      payload: {
        route: { pathname: "/settings", search: "?tab=profile", hash: "" },
      },
    })
  })

  it("returns resolved, route-mismatched, and missing anchors and refreshes geometry", async () => {
    const { parent, postMessage, preview } = bridgeWindow()
    const button = preview.document.createElement("button")
    button.id = "save"
    button.setAttribute("aria-label", "Save")
    let textContentReads = 0
    Object.defineProperty(button, "textContent", {
      configurable: true,
      get() {
        textContentReads += 1
        return "Save"
      },
    })
    button.getBoundingClientRect = () => ({
      bottom: 62,
      height: 32,
      left: 20,
      right: 120,
      top: 30,
      width: 100,
      x: 20,
      y: 30,
      toJSON: () => ({}),
    })
    preview.document.body.append(button)
    dispatchMessage(
      preview,
      parent,
      message("replica:bridge:resolve-anchors", {
        replace: true,
        anchors: [
          { commentId: 1, originBuild: true, anchor: anchor() },
          {
            commentId: 2,
            originBuild: false,
            anchor: anchor({ route: { pathname: "/other", search: "", hash: "" } }),
          },
          { commentId: 3, originBuild: false, anchor: anchor({ selector: "#missing" }) },
          {
            commentId: 4,
            originBuild: false,
            anchor: anchor({ rect: { x: 0, y: 0, width: 100, height: 32 } }),
          },
          {
            commentId: 5,
            originBuild: false,
            anchor: anchor({ accessibleName: "Publish" }),
          },
        ],
      }),
    )

    expect(postedMessages(postMessage).at(-1)).toMatchObject({
      type: "replica:bridge:anchors-resolved",
      payload: {
        results: [
          {
            commentId: 1,
            status: "resolved",
            rect: { x: 20, y: 30, width: 100, height: 32 },
            point: { x: 70, y: 46 },
          },
          { commentId: 2, status: "route-mismatch" },
          { commentId: 3, status: "moved" },
          { commentId: 4, status: "moved" },
          { commentId: 5, status: "changed" },
        ],
      },
    })
    expect(textContentReads).toBe(0)

    postMessage.mockClear()
    preview.dispatchEvent(new preview.Event("resize"))
    await new Promise<void>((resolve) => preview.requestAnimationFrame(() => resolve()))

    expect(
      postedMessages(postMessage).some(
        (entry) =>
          typeof entry === "object" &&
          entry !== null &&
          "type" in entry &&
          entry.type === "replica:bridge:anchors-resolved",
      ),
    ).toBe(true)
    expect(textContentReads).toBe(0)
  })

  it("resolves original, moved, changed, and missing area anchors without guessing", () => {
    const { parent, postMessage, preview } = bridgeWindow()
    const button = preview.document.createElement("button")
    button.id = "save"
    button.setAttribute("aria-label", "Save")
    button.textContent = "Save changes"
    button.getBoundingClientRect = () => ({
      bottom: 162,
      height: 32,
      left: 220,
      right: 320,
      top: 130,
      width: 100,
      x: 220,
      y: 130,
      toJSON: () => ({}),
    })
    preview.document.body.append(button)
    const cancelButton = preview.document.createElement("button")
    cancelButton.id = "cancel"
    cancelButton.setAttribute("aria-label", "Cancel")
    cancelButton.textContent = "Cancel"
    cancelButton.getBoundingClientRect = () => ({
      bottom: 232,
      height: 32,
      left: 600,
      right: 650,
      top: 200,
      width: 50,
      x: 600,
      y: 200,
      toJSON: () => ({}),
    })
    preview.document.body.append(cancelButton)

    dispatchMessage(
      preview,
      parent,
      message("replica:bridge:resolve-anchors", {
        replace: true,
        anchors: [
          { commentId: 1, originBuild: true, anchor: areaAnchor() },
          { commentId: 2, originBuild: false, anchor: areaAnchor() },
          {
            commentId: 3,
            originBuild: false,
            anchor: areaAnchor({
              elements: [
                {
                  selector: "#save",
                  accessibleName: "Publish",
                  tagName: "button",
                  role: "",
                  textExcerpt: "Publish changes",
                  rect: { x: 20, y: 30, width: 100, height: 32 },
                },
              ],
            }),
          },
          {
            commentId: 4,
            originBuild: false,
            anchor: areaAnchor({
              elements: [
                {
                  selector: "#missing",
                  accessibleName: "",
                  tagName: "section",
                  role: "",
                  textExcerpt: "",
                  rect: { x: 20, y: 30, width: 100, height: 32 },
                },
              ],
            }),
          },
          {
            commentId: 5,
            originBuild: false,
            anchor: areaAnchor({
              elements: [
                {
                  selector: "#save",
                  accessibleName: "Save",
                  tagName: "button",
                  role: "",
                  textExcerpt: "Save changes",
                  rect: { x: 20, y: 30, width: 100, height: 32 },
                },
                {
                  selector: "#cancel",
                  accessibleName: "Cancel",
                  tagName: "button",
                  role: "",
                  textExcerpt: "Cancel",
                  rect: { x: 140, y: 30, width: 100, height: 32 },
                },
              ],
            }),
          },
        ],
      }),
    )

    expect(postedMessages(postMessage).at(-1)).toMatchObject({
      payload: {
        results: [
          {
            commentId: 1,
            status: "resolved",
            rect: { x: 20, y: 30, width: 100, height: 60 },
          },
          {
            commentId: 2,
            status: "moved",
            rect: { x: 220, y: 130, width: 100, height: 60 },
          },
          { commentId: 3, status: "changed" },
          { commentId: 4, status: "missing" },
          { commentId: 5, status: "changed" },
        ],
      },
    })
  })

  it("clears a timed focus highlight before element selection begins", () => {
    const { parent, preview } = bridgeWindow()
    const button = preview.document.createElement("button")
    button.id = "save"
    button.setAttribute("aria-label", "Save")
    button.scrollIntoView = vi.fn()
    button.getBoundingClientRect = () => ({
      bottom: 62,
      height: 32,
      left: 20,
      right: 120,
      top: 30,
      width: 100,
      x: 20,
      y: 30,
      toJSON: () => ({}),
    })
    preview.document.body.append(button)
    const clearTimeout = vi.spyOn(preview, "clearTimeout")

    dispatchMessage(
      preview,
      parent,
      message("replica:bridge:resolve-anchors", {
        replace: true,
        anchors: [{ commentId: 1, originBuild: true, anchor: anchor() }],
      }),
    )
    dispatchMessage(preview, parent, message("replica:bridge:focus-anchor", { commentId: 1 }))
    dispatchMessage(preview, parent, message("replica:bridge:select-element"))
    button.dispatchEvent(new preview.MouseEvent("pointermove", { bubbles: true }))

    const highlight = preview.document.querySelector<HTMLElement>(
      "[data-replica-bridge='highlight']",
    )
    expect(clearTimeout).toHaveBeenCalled()
    expect(highlight?.style.opacity).toBe("1")
  })

  it("scrolls a resolved area into view before reporting focus", () => {
    const { parent, postMessage, preview } = bridgeWindow()
    const scrollTo = vi.fn()
    Object.defineProperty(preview, "scrollTo", { configurable: true, value: scrollTo })

    dispatchMessage(
      preview,
      parent,
      message("replica:bridge:resolve-anchors", {
        replace: true,
        anchors: [{ commentId: 1, originBuild: true, anchor: areaAnchor() }],
      }),
    )
    dispatchMessage(preview, parent, message("replica:bridge:focus-anchor", { commentId: 1 }))

    expect(scrollTo).toHaveBeenCalledWith({
      left: 0,
      top: 0,
      behavior: "auto",
    })
    expect(postedMessages(postMessage).at(-1)).toMatchObject({
      type: "replica:bridge:anchor-focused",
      payload: {
        result: {
          commentId: 1,
          status: "resolved",
          rect: { x: 20, y: 30, width: 100, height: 60 },
        },
      },
    })
  })
})

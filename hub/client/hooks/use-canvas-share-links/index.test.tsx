import { act, renderHook, waitFor } from "@testing-library/react"
import { useLayoutEffect } from "react"
import { describe, expect, it, vi } from "vitest"

import {
  importedPrototype,
  publicationHub,
  publicationState,
} from "@utils/resolve-prototype-publication/fixtures"
import type { ShareContext } from "./types"
import type { HubStatus, PrototypeState } from "@utils/prototype-canvas/types"
import { useShareLinks } from "."

const status: HubStatus = {
  ...publicationHub,
  state: "connected",
  prototype: { ...importedPrototype, canManageShareLinks: true },
}
const context: ShareContext = {
  target: "opaque-target",
  hubOrigin: "https://hub.example.com",
  repository: "github/example",
  branch: "prototype/welcome",
  prototype: { ...importedPrototype, canManageShareLinks: true },
}
const link = {
  id: 1,
  label: "Review",
  buildNumber: 1,
  url: "https://hub.example.com/share/12345678-1234-1234-1234-123456789abc",
  expiresAt: null,
  createdAt: "2026-10-05T07:00:00Z",
  createdBy: { login: "octocat", name: null },
}

type HookProps = {
  hubStatus: HubStatus
  token?: string
  prototypeState?: PrototypeState
}

function fixture() {
  const calls: { action: string; input: Record<string, unknown> }[] = []
  const fetchMock = vi.fn((path: string, options: RequestInit) => {
    const action = path.split("/").at(-1)!
    if (typeof options.body !== "string") throw new Error("Expected a JSON body.")
    const input = JSON.parse(options.body) as Record<string, unknown>
    calls.push({ action, input })
    return Promise.resolve(
      new Response(
        JSON.stringify(
          action === "context"
            ? context
            : action === "list"
              ? { shareLinks: [link], hasMore: false, nextCursor: null }
              : action === "create"
                ? link
                : { deleted: true },
        ),
      ),
    )
  })
  vi.stubGlobal("fetch", fetchMock)
  const initialProps: HookProps = { hubStatus: status }
  const hook = renderHook(
    ({ hubStatus, token = "local-token", prototypeState = publicationState }: HookProps) =>
      useShareLinks({ token, hubStatus, prototypeState }),
    { initialProps },
  )
  return { ...hook, calls, fetchMock }
}

function pendingResponse() {
  function unfinished() {
    throw new Error("Request has not started.")
  }
  let finish: (response: Response) => void = unfinished
  const promise = new Promise<Response>((resolve) => {
    finish = resolve
  })
  return { promise, finish }
}

describe("useShareLinks()", () => {
  it("keeps a sharing request opened as the Hub becomes ready", async () => {
    const response = pendingResponse()
    const readerContext = {
      ...context,
      prototype: { ...context.prototype, canManageShareLinks: false },
    }
    const fetch = vi.fn(() => response.promise)
    vi.stubGlobal("fetch", fetch)
    let opening: Promise<void> | undefined
    const initialProps: { hubStatus: HubStatus | null } = { hubStatus: null }
    const view = renderHook(
      ({ hubStatus }: { hubStatus: HubStatus | null }) => {
        const sharing = useShareLinks({
          token: "local-token",
          hubStatus,
          prototypeState: publicationState,
        })
        const { open } = sharing
        useLayoutEffect(() => {
          if (hubStatus?.state === "connected") opening = open()
        }, [hubStatus, open])
        return sharing
      },
      { initialProps },
    )
    view.rerender({ hubStatus: status })
    expect(fetch).toHaveBeenCalledTimes(1)
    await act(async () => {
      response.finish(Response.json(readerContext))
      await opening
    })
    expect(view.result.current.state.context).toEqual(readerContext)
    expect(view.result.current.state.open).toBe(true)
    expect(view.result.current.state.loading).toBe(false)
    expect(view.result.current.state.stale).toBe(false)
    expect(view.result.current.state.error).toBe("")
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each([false, undefined])(
    "reads internal context without listing or mutating public links for permission %s",
    async (permission) => {
      const f = fixture()
      const prototype = { ...importedPrototype, canEdit: false, canManageShareLinks: permission }
      f.rerender({ hubStatus: { ...status, prototype } })
      f.fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ...context, prototype })))
      await act(async () => f.result.current.open())
      expect(f.result.current.state.context?.prototype.build?.url).toBe(
        importedPrototype.build!.url,
      )
      expect(f.result.current.state.stale).toBe(false)
      await act(async () => {
        await f.result.current.refresh()
        expect(await f.result.current.create("Review", "never")).toBe(false)
        expect(await f.result.current.remove(1)).toBe(false)
      })
      expect(f.calls.filter((call) => call.action !== "context")).toEqual([])
      expect(f.fetchMock).toHaveBeenCalledTimes(1)
    },
  )

  it("removes public links but keeps internal review when public-sharing permission is revoked", async () => {
    const f = fixture()
    await act(async () => f.result.current.open())
    expect(f.result.current.state.links).toEqual([link])
    f.rerender({
      hubStatus: {
        ...status,
        prototype: { ...importedPrototype, canManageShareLinks: false },
      },
    })
    expect(f.result.current.state.context?.prototype.build?.url).toBe(importedPrototype.build!.url)
    expect(f.result.current.state.links).toEqual([])
    expect(f.result.current.state.context?.prototype.canManageShareLinks).toBe(false)
    await act(async () => {
      expect(await f.result.current.create("Review", "never")).toBe(false)
    })
  })

  it("keeps the captured internal Build when deployment sharing is disabled", async () => {
    const f = fixture()
    await act(async () => f.result.current.open())
    const capturedBuild = f.result.current.state.context!.prototype.build
    const calls = f.fetchMock.mock.calls.length
    f.rerender({
      hubStatus: {
        ...status,
        prototype: {
          ...importedPrototype,
          publicSharingEnabled: false,
          build: { ...importedPrototype.build!, number: 99 },
        },
      },
    })
    expect(f.result.current.state.context?.prototype.build).toEqual(capturedBuild)
    expect(f.result.current.state.context?.prototype.publicSharingEnabled).toBe(false)
    expect(f.result.current.state.sharingDisabled).toBe(true)
    expect(f.result.current.state.links).toEqual([])
    expect(f.result.current.state.created).toBeNull()
    await act(async () => {
      expect(await f.result.current.create("Review", "seven_days")).toBe(false)
      expect(await f.result.current.remove(1)).toBe(false)
    })
    expect(f.fetchMock).toHaveBeenCalledTimes(calls)
  })

  it("clears remembered public URLs on a deployment denial and recaptures context on refresh", async () => {
    const f = fixture()
    await act(async () => {
      await f.result.current.open()
    })
    expect(f.result.current.state.links).toHaveLength(1)
    f.fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: "Public sharing is disabled", code: "public_sharing_disabled" }),
        { status: 403 },
      ),
    )
    await act(async () => {
      expect(await f.result.current.create("Review", "seven_days")).toBe(false)
    })
    expect(f.result.current.state.sharingDisabled).toBe(true)
    expect(f.result.current.state.links).toEqual([])
    expect(f.result.current.state.created).toBeNull()
    expect(f.result.current.state.authorization).toBeUndefined()
    expect(f.result.current.state.busy).toBe(false)
    expect(f.result.current.state.loading).toBe(false)
    await act(async () => {
      await f.result.current.refresh()
    })
    expect(f.calls.at(-2)?.action).toBe("context")
    expect(f.result.current.state.sharingDisabled).toBe(false)
    expect(f.result.current.state.links).toHaveLength(1)
  })

  it.each([
    ["open", "public_sharing_disabled"],
    ["open", "public_sharing_changed"],
    ["open", "creator_access_changed"],
    ["authorize", "public_sharing_disabled"],
    ["authorize", "public_sharing_changed"],
    ["authorize", "creator_access_changed"],
  ])("ignores a late list after %s returns %s", async (action, code) => {
    const f = fixture()
    await act(async () => {
      await f.result.current.open()
    })
    await act(async () => {
      await f.result.current.create("Review", "seven_days")
    })
    f.fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: "fresh_authorization_required",
          authorization: {
            url: "https://hub.example.com/authorization/12345678-1234-1234-1234-123456789abc",
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          },
        }),
        { status: 403 },
      ),
    )
    await act(async () => {
      await f.result.current.create("Review", "never")
    })
    await act(async () => {
      await f.result.current.refresh()
    })
    expect(f.result.current.state.created).toEqual(link)
    expect(f.result.current.state.authorization).toBeDefined()
    const denial = pendingResponse()
    f.fetchMock.mockImplementationOnce(() => denial.promise)
    let actionRequest = Promise.resolve()
    act(() => {
      actionRequest =
        action === "open" ? f.result.current.openLink(link.id) : f.result.current.authorize()
    })
    const list = pendingResponse()
    f.fetchMock.mockImplementationOnce(() => list.promise)
    let listRequest: Promise<unknown> = Promise.resolve()
    act(() => {
      listRequest = f.result.current.refresh() ?? Promise.resolve()
    })
    expect(f.result.current.state.loading).toBe(true)
    await act(async () => {
      denial.finish(
        new Response(JSON.stringify({ code, error: "Sharing access changed" }), { status: 403 }),
      )
      await actionRequest
    })
    expect(f.result.current.state.loading).toBe(false)
    expect(f.result.current.state.busy).toBe(false)
    await act(async () => {
      list.finish(
        new Response(JSON.stringify({ shareLinks: [link], hasMore: false, nextCursor: null })),
      )
      await listRequest
    })
    expect(f.result.current.state.context).toEqual(context)
    expect(f.result.current.state.stale).toBe(true)
    expect(f.result.current.state.sharingDisabled).toBe(code === "public_sharing_disabled")
    expect(f.result.current.state.links).toEqual([])
    expect(f.result.current.state.created).toBeNull()
    expect(f.result.current.state.authorization).toBeUndefined()
    expect(f.result.current.state.loading).toBe(false)
    expect(f.result.current.state.busy).toBe(false)
    expect(f.result.current.state.error).toBe("Sharing access changed")
  })

  it("does not fetch links or dispatch mutations when context says sharing is disabled", async () => {
    const f = fixture()
    f.fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ...context,
          prototype: { ...context.prototype, publicSharingEnabled: false },
        }),
      ),
    )
    await act(async () => {
      await f.result.current.open()
      expect(await f.result.current.create("Review", "seven_days")).toBe(false)
    })
    expect(f.calls).toEqual([])
    expect(f.fetchMock).toHaveBeenCalledTimes(1)
    expect(f.result.current.state.context?.prototype.publicSharingEnabled).toBe(false)
  })

  it.each([
    ["open", "public_sharing_disabled"],
    ["open", "public_sharing_changed"],
    ["open", "creator_access_changed"],
    ["authorize", "public_sharing_disabled"],
    ["authorize", "public_sharing_changed"],
    ["authorize", "creator_access_changed"],
  ])("forgets URLs and challenges after %s returns %s", async (action, code) => {
    const f = fixture()
    await act(async () => {
      await f.result.current.open()
    })
    if (action === "authorize") {
      f.fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: "fresh_authorization_required",
            authorization: {
              url: "https://hub.example.com/authorization/12345678-1234-1234-1234-123456789abc",
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
            },
          }),
          { status: 403 },
        ),
      )
      await act(async () => {
        await f.result.current.create("Review", "never")
      })
      expect(f.result.current.state.authorization).toBeDefined()
    }
    expect(f.result.current.state.links).toHaveLength(1)
    f.fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ code, error: "Sharing policy changed" }), { status: 403 }),
    )
    await act(async () => {
      if (action === "open") await f.result.current.openLink(link.id)
      else await f.result.current.authorize()
    })
    expect(f.result.current.state.stale).toBe(true)
    expect(f.result.current.state.sharingDisabled).toBe(code === "public_sharing_disabled")
    expect(f.result.current.state.links).toEqual([])
    expect(f.result.current.state.created).toBeNull()
    expect(f.result.current.state.authorization).toBeUndefined()
  })
  it("saves only the checkbox choice for the captured target and reports transport errors", async () => {
    const f = fixture()
    await act(async () => f.result.current.open())
    f.fetchMock.mockImplementationOnce(() =>
      Promise.resolve(new Response(JSON.stringify({ included: true }))),
    )
    await act(async () => f.result.current.setControlPreference(true))
    const [path, options] = f.fetchMock.mock.calls.at(-1)!
    expect(path).toBe("/api/hub/share-links/controls-preference")
    expect(typeof options.body).toBe("string")
    if (typeof options.body !== "string") throw new Error("Expected a JSON body.")
    expect(JSON.parse(options.body)).toEqual({ target: context.target, included: true })
    expect(f.calls.some((call) => call.action === "create")).toBe(false)
    f.fetchMock.mockImplementationOnce(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: "Storage unavailable." }), { status: 500 }),
      ),
    )
    await act(async () =>
      expect(f.result.current.setControlPreference(false)).rejects.toThrow("Storage unavailable."),
    )
  })

  it.each(["reader", "unknown permission", "sharing disabled"])(
    "saves and restores internal sharing preferences for %s without requesting public links",
    async (mode) => {
      const f = fixture()
      const prototype = {
        ...context.prototype,
        canManageShareLinks:
          mode === "reader" ? false : mode === "unknown permission" ? undefined : true,
        publicSharingEnabled: mode !== "sharing disabled",
      }
      let included = false
      f.fetchMock.mockImplementation((path, options) => {
        if (path.endsWith("/context"))
          return Promise.resolve(
            new Response(
              JSON.stringify({ ...context, prototype, controlSettingsIncluded: included }),
            ),
          )
        if (!path.endsWith("/controls-preference") || typeof options.body !== "string")
          throw new Error("Only context and preference requests are expected.")
        const input = JSON.parse(options.body) as { target: string; included: boolean }
        expect(input.target).toBe(context.target)
        included = input.included
        return Promise.resolve(new Response(JSON.stringify({ included })))
      })
      await act(async () => f.result.current.open())
      await act(async () => f.result.current.setControlPreference(true))
      act(() => f.result.current.close())
      await act(async () => f.result.current.open())
      expect(f.result.current.state.context?.controlSettingsIncluded).toBe(true)
      await act(async () => f.result.current.setControlPreference(false))
      act(() => f.result.current.close())
      await act(async () => f.result.current.open())
      expect(f.result.current.state.context?.controlSettingsIncluded).toBe(false)
      expect(f.fetchMock.mock.calls.map(([path]) => path.split("/").at(-1))).toEqual([
        "context",
        "controls-preference",
        "context",
        "controls-preference",
        "context",
      ])
      expect(f.result.current.state.links).toEqual([])
    },
  )

  it("saves local preferences after a public list failure without enabling public mutations", async () => {
    const f = fixture()
    f.fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(context)))
    f.fetchMock.mockRejectedValueOnce(new Error("Hub unavailable."))
    await act(async () => f.result.current.open())
    expect(f.result.current.state.stale).toBe(true)
    f.fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ included: true })))
    await act(async () => f.result.current.setControlPreference(true))
    expect(f.fetchMock.mock.calls.at(-1)?.[0]).toBe("/api/hub/share-links/controls-preference")
    expect(f.result.current.state.stale).toBe(true)
    await act(async () => {
      expect(await f.result.current.create("Review", "seven_days")).toBe(false)
    })
  })

  it("rejects a preference result after the checkout changes", async () => {
    const f = fixture()
    await act(async () => f.result.current.open())
    const outstanding = pendingResponse()
    f.fetchMock.mockImplementationOnce(() => outstanding.promise)
    let saved: Promise<void> = Promise.resolve()
    act(() => {
      saved = f.result.current.setControlPreference(true)
    })
    const rejected = expect(saved).rejects.toThrow()
    f.rerender({ hubStatus: { ...status, branch: "prototype/changed" } })
    await act(async () => {
      outstanding.finish(new Response(JSON.stringify({ included: true })))
      await rejected
    })
  })

  it("keeps a challenged creation unapplied until an explicit retry after browser verification", async () => {
    const f = fixture()
    await act(async () => {
      await f.result.current.open()
    })
    const authorization = {
      url: "https://hub.example.com/authorization/12345678-1234-1234-1234-123456789abc",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }
    f.fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: "Fresh GitHub authorization is required. No changes were made.",
          code: "fresh_authorization_required",
          authorization,
        }),
        { status: 403 },
      ),
    )
    await act(async () => {
      expect(await f.result.current.create("Review", "never")).toBe(false)
    })
    expect(f.result.current.state.authorization).toEqual(authorization)
    expect(f.result.current.state.created).toBeNull()
    expect(f.result.current.state.stale).toBe(true)
    await act(async () => {
      await f.result.current.authorize()
    })
    expect(f.fetchMock.mock.calls.filter(([url]) => url.endsWith("create"))).toHaveLength(1)
    expect(f.fetchMock.mock.calls.filter(([url]) => url.endsWith("authorize"))).toHaveLength(1)
    await act(async () => {
      await f.result.current.refresh()
    })
    expect(f.fetchMock.mock.calls.filter(([url]) => url.endsWith("create"))).toHaveLength(1)
    await act(async () => {
      expect(await f.result.current.create("Review", "never")).toBe(true)
    })
    expect(f.fetchMock.mock.calls.filter(([url]) => url.endsWith("create"))).toHaveLength(2)
    expect(f.result.current.state.authorization).toBeUndefined()
  })

  it.each(["context", "list", "create", "delete", "failed creation"])(
    "captures a fresh Build after reopening during a pending %s without replaying mutations",
    async (phase) => {
      const f = fixture()
      if (phase !== "context") {
        await act(async () => {
          await f.result.current.open()
        })
      }
      const outstanding = pendingResponse()
      f.fetchMock.mockImplementationOnce(() => outstanding.promise)
      let pending: Promise<unknown> = Promise.resolve()
      act(() => {
        pending =
          phase === "context"
            ? f.result.current.open()
            : phase === "list"
              ? f.result.current.refresh()
              : phase === "delete"
                ? f.result.current.remove(link.id)
                : f.result.current.create("Review", "never")
      })
      act(() => f.result.current.close())
      const nextContext: ShareContext = {
        ...context,
        target: "build-2-target",
        prototype: {
          ...context.prototype,
          build: { ...importedPrototype.build!, number: 2 },
        },
      }
      f.rerender({ hubStatus: { ...status, prototype: nextContext.prototype } })
      const contextRead = pendingResponse()
      const listRead = pendingResponse()
      f.fetchMock.mockImplementation((path: string, options: RequestInit) => {
        if (path.endsWith("context")) return contextRead.promise
        if (typeof options.body !== "string") throw new Error("Expected a JSON body.")
        const input = JSON.parse(options.body) as Record<string, unknown>
        if (input.target === nextContext.target) return listRead.promise
        return Promise.resolve(
          new Response(JSON.stringify({ shareLinks: [], hasMore: false, nextCursor: null })),
        )
      })
      await act(async () => {
        await f.result.current.open()
      })
      expect(f.result.current.state.loading).toBe(true)
      expect(f.result.current.state.stale).toBe(true)
      const before = f.fetchMock.mock.calls.length
      await act(async () => {
        expect(await f.result.current.create("Blocked", "never")).toBe(false)
        expect(await f.result.current.remove(link.id)).toBe(false)
      })
      expect(f.fetchMock).toHaveBeenCalledTimes(before)
      await act(async () => {
        outstanding.finish(
          new Response(
            JSON.stringify(
              phase === "context"
                ? context
                : phase === "list"
                  ? { shareLinks: [link], hasMore: false, nextCursor: null }
                  : phase === "delete"
                    ? { deleted: true }
                    : phase === "failed creation"
                      ? { error: "Timed out", code: "share_delivery_unknown" }
                      : link,
            ),
            { status: phase === "failed creation" ? 502 : 200 },
          ),
        )
        await pending
      })
      expect(f.result.current.state.context).toBeNull()
      expect(f.result.current.state.loading).toBe(true)
      act(() => {
        contextRead.finish(new Response(JSON.stringify(nextContext)))
      })
      await waitFor(() => expect(f.result.current.state.context?.prototype.build?.number).toBe(2))
      expect(f.result.current.state.loading).toBe(true)
      expect(f.result.current.state.stale).toBe(true)
      await act(async () => {
        expect(await f.result.current.create("Still blocked", "never")).toBe(false)
      })
      act(() => {
        listRead.finish(
          new Response(JSON.stringify({ shareLinks: [], hasMore: false, nextCursor: null })),
        )
      })
      await waitFor(() => expect(f.result.current.state.loading).toBe(false))
      expect(f.result.current.state.stale).toBe(false)
      expect(f.fetchMock.mock.calls.filter(([path]) => path.endsWith("context"))).toHaveLength(2)
      expect(
        f.fetchMock.mock.calls.filter(
          ([path]) => path.endsWith("create") || path.endsWith("delete"),
        ),
      ).toHaveLength(["create", "delete", "failed creation"].includes(phase) ? 1 : 0)
      const newLink = { ...link, buildNumber: 2 }
      f.fetchMock
        .mockResolvedValueOnce(new Response(JSON.stringify(newLink)))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ shareLinks: [newLink], hasMore: false, nextCursor: null })),
        )
      await act(async () => {
        expect(await f.result.current.create("New Build", "never")).toBe(true)
      })
      const creation = f.fetchMock.mock.calls.filter(([path]) => path.endsWith("create")).at(-1)
      expect(creation?.[1].body).toBe(
        JSON.stringify({
          target: nextContext.target,
          label: "New Build",
          expiration: "never",
          buildNumber: 2,
        }),
      )
    },
  )

  it("cancels a queued reopening when the user closes again before the request settles", async () => {
    const f = fixture()
    const outstanding = pendingResponse()
    f.fetchMock.mockImplementationOnce(() => outstanding.promise)
    let pending: Promise<void> = Promise.resolve()
    act(() => {
      pending = f.result.current.open()
    })
    act(() => f.result.current.close())
    await act(async () => {
      await f.result.current.open()
    })
    act(() => f.result.current.close())
    await act(async () => {
      outstanding.finish(new Response(JSON.stringify(context)))
      await pending
    })
    expect(f.result.current.state.open).toBe(false)
    expect(f.result.current.state.loading).toBe(false)
    expect(f.fetchMock.mock.calls.filter(([path]) => path.endsWith("context"))).toHaveLength(1)
  })

  it.each([
    ["context", "checkout"],
    ["context", "token"],
    ["list", "checkout"],
    ["list", "token"],
    ["create", "checkout"],
    ["create", "token"],
  ])(
    "recaptures the latest context after a pending %s is invalidated by a changed %s",
    async (phase, invalidation) => {
      const f = fixture()
      if (phase !== "context") {
        await act(async () => {
          await f.result.current.open()
        })
      }
      const outstanding = pendingResponse()
      f.fetchMock.mockImplementationOnce(() => outstanding.promise)
      let pending: Promise<unknown> = Promise.resolve()
      act(() => {
        pending =
          phase === "context"
            ? f.result.current.open()
            : phase === "list"
              ? f.result.current.refresh()
              : f.result.current.create("Review", "never")
      })
      act(() => f.result.current.close())
      await act(async () => {
        await f.result.current.open()
      })
      const nextContext: ShareContext = {
        ...context,
        branch: invalidation === "checkout" ? "prototype/other" : context.branch,
        target: "fresh-target",
        prototype: {
          ...context.prototype,
          build: { ...importedPrototype.build!, number: 2 },
        },
      }
      const nextToken = invalidation === "token" ? "updated-token" : "local-token"
      f.rerender({
        hubStatus: { ...status, branch: nextContext.branch, prototype: nextContext.prototype },
        prototypeState: {
          ...publicationState,
          stats: { ...publicationState.stats, branch: nextContext.branch },
        },
        token: nextToken,
      })
      const freshContext = pendingResponse()
      const freshList = pendingResponse()
      f.fetchMock.mockImplementation((path: string) =>
        path.endsWith("context") ? freshContext.promise : freshList.promise,
      )
      const count = f.fetchMock.mock.calls.length
      await act(async () => {
        expect(await f.result.current.create("Blocked", "never")).toBe(false)
        expect(await f.result.current.remove(link.id)).toBe(false)
      })
      expect(f.fetchMock).toHaveBeenCalledTimes(count)
      await act(async () => {
        outstanding.finish(
          new Response(
            JSON.stringify(
              phase === "context"
                ? context
                : phase === "list"
                  ? { shareLinks: [link], hasMore: true, nextCursor: "old-cursor" }
                  : link,
            ),
          ),
        )
        await pending
      })
      expect(f.result.current.state.context).toBeNull()
      expect(f.result.current.state.created).toBeNull()
      expect(f.result.current.state.loading).toBe(true)
      expect(f.fetchMock.mock.calls.at(-1)?.[0]).toMatch(/context$/)
      expect(f.fetchMock.mock.calls.at(-1)?.[1].headers).toMatchObject({
        "X-Replica-Canvas-Token": nextToken,
      })
      act(() => {
        freshContext.finish(new Response(JSON.stringify(nextContext)))
      })
      await waitFor(() => expect(f.result.current.state.context).toEqual(nextContext))
      expect(f.result.current.state.stale).toBe(true)
      await act(async () => {
        expect(await f.result.current.create("Still blocked", "never")).toBe(false)
        expect(await f.result.current.remove(link.id)).toBe(false)
      })
      expect(f.fetchMock.mock.calls.at(-1)?.[1].body).toBe(
        JSON.stringify({ target: nextContext.target }),
      )
      act(() => {
        freshList.finish(
          new Response(JSON.stringify({ shareLinks: [], hasMore: false, nextCursor: null })),
        )
      })
      await waitFor(() => expect(f.result.current.state.loading).toBe(false))
      expect(f.result.current.state.open).toBe(true)
      expect(f.result.current.state.stale).toBe(false)
      expect(f.fetchMock).toHaveBeenCalledTimes(count + 2)
      expect(
        f.fetchMock.mock.calls.filter(
          ([path]) => path.endsWith("create") || path.endsWith("delete"),
        ),
      ).toHaveLength(phase === "create" ? 1 : 0)
    },
  )

  it("cancels a queued reopening on unmount without dispatching another request", async () => {
    const f = fixture()
    const outstanding = pendingResponse()
    f.fetchMock.mockImplementationOnce(() => outstanding.promise)
    let pending: Promise<void> = Promise.resolve()
    act(() => {
      pending = f.result.current.open()
    })
    act(() => f.result.current.close())
    await act(async () => {
      await f.result.current.open()
    })
    f.unmount()
    await act(async () => {
      outstanding.finish(new Response(JSON.stringify(context)))
      await pending
    })
    expect(f.fetchMock).toHaveBeenCalledOnce()
  })

  it("retains the first created URL when its initial paginated list refresh fails", async () => {
    const f = fixture()
    f.fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(context)))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ shareLinks: [], hasMore: false, nextCursor: null })),
      )
    await act(async () => {
      await f.result.current.open()
    })
    f.fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(link)))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            shareLinks: [{ ...link, id: 2 }],
            hasMore: true,
            nextCursor: "next-page",
          }),
        ),
      )
      .mockRejectedValueOnce(new Error("Next page unavailable"))
    await act(async () => {
      expect(await f.result.current.create("Review", "never")).toBe(true)
    })
    expect(f.result.current.state.created).toEqual(link)
    expect(f.result.current.state.links).toEqual([])
    expect(f.result.current.state.loading).toBe(false)
    expect(f.result.current.state.stale).toBe(true)
    expect(f.result.current.state.error).toBe("Next page unavailable")
    const count = f.fetchMock.mock.calls.length
    await act(async () => {
      expect(await f.result.current.create("Blocked", "never")).toBe(false)
    })
    expect(f.fetchMock).toHaveBeenCalledTimes(count)
    await act(async () => {
      await f.result.current.refresh()
    })
    expect(f.result.current.state.created).toEqual(link)
    expect(f.result.current.state.links).toEqual([link])
    expect(f.result.current.state.stale).toBe(false)
  })

  it("forgets a created URL absent from a complete list so a later failure cannot revive it", async () => {
    const f = fixture()
    await act(async () => {
      await f.result.current.open()
    })
    await act(async () => {
      await f.result.current.create("Review", "never")
    })
    expect(f.result.current.state.created).toEqual(link)
    f.fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ shareLinks: [], hasMore: false, nextCursor: null })),
    )
    await act(async () => {
      await f.result.current.refresh()
    })
    expect(f.result.current.state.created).toBeNull()
    expect(f.result.current.state.links).toEqual([])
    f.fetchMock.mockRejectedValueOnce(new Error("List unavailable"))
    await act(async () => {
      await f.result.current.refresh()
    })
    expect(f.result.current.state.stale).toBe(true)
    expect(f.result.current.state.created).toBeNull()
  })

  it("only reads context and active links when opened; a newer Build never changes the target", async () => {
    const f = fixture()
    expect(f.calls).toEqual([])
    await act(async () => {
      await f.result.current.open()
    })
    expect(f.calls.map((call) => call.action)).toEqual(["context", "list"])
    expect(f.result.current.state.links).toEqual([link])
    f.rerender({
      hubStatus: {
        ...status,
        prototype: {
          ...importedPrototype,
          build: { ...importedPrototype.build!, number: 2 },
          canManageShareLinks: true,
        },
      },
    })
    expect(f.result.current.state.context?.prototype.build?.number).toBe(1)
    await act(async () => {
      await f.result.current.create("Review", "never")
    })
    expect(f.calls.find((call) => call.action === "create")?.input).toEqual({
      target: context.target,
      buildNumber: 1,
      label: "Review",
      expiration: "never",
    })
    expect(f.result.current.state.notice).toBe("")
    expect(f.result.current.state.created).toEqual(link)
    expect(f.result.current.state.links).toEqual([link])
  })

  it("shows a disconnected explanation without making any Hub sharing request", async () => {
    const f = fixture()
    f.rerender({ hubStatus: { state: "disconnected" } })
    await act(async () => {
      await f.result.current.open()
    })
    expect(f.result.current.state.error).toMatch(/Connect to Hub/)
    expect(f.calls).toEqual([])
  })

  it("disables mutations on a failed list, rather than reporting an empty success", async () => {
    const f = fixture()
    f.fetchMock.mockImplementation((path: string) =>
      Promise.resolve(
        new Response(
          JSON.stringify(path.endsWith("context") ? context : { error: "Unavailable" }),
          { status: path.endsWith("context") ? 200 : 503 },
        ),
      ),
    )
    await act(async () => {
      await f.result.current.open()
    })
    expect(f.result.current.state.stale).toBe(true)
    expect(f.result.current.state.error).toBe("Unavailable")
    await act(async () => {
      await f.result.current.create("Review", "seven_days")
    })
    expect(f.fetchMock).toHaveBeenCalledTimes(2)
  })

  it("guards duplicate creation, tracks completion while closed, and rereads on reopening", async () => {
    const f = fixture()
    await act(async () => {
      await f.result.current.open()
    })
    function unfinished() {
      throw new Error("Request has not started.")
    }
    let finish: (response: Response) => void = unfinished
    f.fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    let pending: Promise<boolean> = Promise.resolve(false)
    act(() => {
      pending = f.result.current.create("Review", "seven_days")
    })
    await act(async () => {
      expect(await f.result.current.create("Review", "seven_days")).toBe(false)
    })
    act(() => f.result.current.close())
    await act(async () => {
      finish(new Response(JSON.stringify(link)))
      await pending
    })
    expect(f.result.current.state.open).toBe(false)
    expect(f.result.current.state.notice).toBe("")
    expect(f.result.current.state.created).toEqual(link)
    await act(async () => {
      await f.result.current.open()
    })
    expect(f.result.current.state.links).toEqual([link])
    expect(f.calls.filter((call) => call.action === "context")).toHaveLength(2)
  })

  it("requires explicit list reconciliation after an unknown outcome and never automatically replays", async () => {
    const f = fixture()
    await act(async () => {
      await f.result.current.open()
    })
    f.fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Timed out", code: "share_delivery_unknown" }), {
        status: 502,
      }),
    )
    await act(async () => {
      await f.result.current.create("Review", "never")
    })
    expect(f.result.current.state.error).toMatch(/may have completed/)
    expect(f.result.current.state.stale).toBe(true)
    const count = f.fetchMock.mock.calls.length
    await act(async () => {
      await f.result.current.create("Review", "never")
    })
    expect(f.fetchMock).toHaveBeenCalledTimes(count)
    await act(async () => {
      await f.result.current.refresh()
    })
    expect(f.result.current.state.stale).toBe(false)
    expect(f.calls.filter((call) => call.action === "create")).toHaveLength(0)
  })

  it("removes a confirmed deleted URL even when the subsequent list refresh fails", async () => {
    const f = fixture()
    await act(async () => {
      await f.result.current.open()
    })
    await act(async () => {
      await f.result.current.create("Review", "never")
    })
    expect(f.result.current.state.created).toEqual(link)
    f.fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ deleted: true })))
      .mockRejectedValueOnce(new Error("List unavailable"))
    await act(async () => {
      expect(await f.result.current.remove(link.id)).toBe(true)
    })
    expect(f.result.current.state.created).toBeNull()
    expect(f.result.current.state.links).toEqual([])
    expect(f.result.current.state.stale).toBe(true)
    expect(f.result.current.state.error).toBe("List unavailable")
    expect(f.result.current.state.notice).toMatch(/deleted/)
  })

  it("invalidates the context on branch changes and ignores stale in-flight results", async () => {
    const f = fixture()
    function unfinished() {
      throw new Error("Request has not started.")
    }
    let finish: (response: Response) => void = unfinished
    f.fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    let pending: Promise<void> = Promise.resolve()
    act(() => {
      pending = f.result.current.open()
    })
    f.rerender({ hubStatus: { ...status, branch: "prototype/other" } })
    await act(async () => {
      finish(new Response(JSON.stringify(context)))
      await pending
    })
    expect(f.result.current.state.context).toBeNull()
    expect(f.result.current.state.error).toMatch(/changed/)
    expect(f.calls).toEqual([])
  })

  it("loads all 51 links across three pages on opening and focus without recapturing the Build", async () => {
    const f = fixture()
    const links = Array.from({ length: 51 }, (_, index) => ({
      ...link,
      id: index + 1,
      buildNumber: Math.floor(index / 25) + 1,
    }))
    f.fetchMock.mockImplementation((path: string, options: RequestInit) => {
      if (typeof options.body !== "string") throw new Error("Expected a JSON body.")
      const input = JSON.parse(options.body) as Record<string, unknown>
      const offset = input.cursor === "cursor-25" ? 25 : input.cursor === "cursor-50" ? 50 : 0
      return Promise.resolve(
        new Response(
          JSON.stringify(
            path.endsWith("context")
              ? context
              : {
                  shareLinks: links.slice(offset, offset + 25),
                  hasMore: offset < 50,
                  nextCursor: offset < 50 ? `cursor-${offset + 25}` : null,
                },
          ),
        ),
      )
    })
    await act(async () => {
      await f.result.current.open()
    })
    expect(f.result.current.state.links).toEqual(links)
    expect(f.result.current.state.loading).toBe(false)
    expect(f.fetchMock).toHaveBeenCalledTimes(4)
    expect(
      f.fetchMock.mock.calls
        .filter(([path]) => path.endsWith("list"))
        .map(([, options]) => {
          if (typeof options.body !== "string") throw new Error("Expected a JSON body.")
          return JSON.parse(options.body) as Record<string, unknown>
        }),
    ).toEqual([
      { target: context.target },
      { target: context.target, cursor: "cursor-25" },
      { target: context.target, cursor: "cursor-50" },
    ])
    act(() => {
      window.dispatchEvent(new Event("focus"))
    })
    await waitFor(() => {
      expect(f.fetchMock).toHaveBeenCalledTimes(7)
      expect(f.result.current.state.loading).toBe(false)
    })
    expect(f.result.current.state.links).toEqual(links)
    expect(f.fetchMock.mock.calls.filter(([path]) => path.endsWith("context"))).toHaveLength(1)
  })

  it("preserves the previous complete list and blocks mutations when a later page fails", async () => {
    const f = fixture()
    await act(async () => {
      await f.result.current.open()
    })
    f.fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            shareLinks: [{ ...link, id: 2 }],
            hasMore: true,
            nextCursor: "cursor",
          }),
        ),
      )
      .mockRejectedValueOnce(new Error("Next page unavailable"))
    await act(async () => {
      await f.result.current.refresh()
    })
    expect(f.result.current.state.links).toEqual([link])
    expect(f.result.current.state.stale).toBe(true)
    expect(f.result.current.state.error).toBe("Next page unavailable")
    expect(f.result.current.state.loading).toBe(false)
    const count = f.fetchMock.mock.calls.length
    await act(async () => {
      expect(await f.result.current.create("Review", "never")).toBe(false)
    })
    expect(f.fetchMock).toHaveBeenCalledTimes(count)
  })

  it("rejects repeated cursors rather than looping or showing a partial list", async () => {
    const f = fixture()
    const page = {
      shareLinks: [link],
      hasMore: true,
      nextCursor: "repeated",
    }
    f.fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(context)))
      .mockResolvedValueOnce(new Response(JSON.stringify(page)))
      .mockResolvedValueOnce(new Response(JSON.stringify(page)))
    await act(async () => {
      await f.result.current.open()
    })
    expect(f.fetchMock).toHaveBeenCalledTimes(3)
    expect(f.result.current.state.links).toEqual([])
    expect(f.result.current.state.stale).toBe(true)
    expect(f.result.current.state.error).toMatch(/repeated share-link page/)
  })

  it("does not read further pages or commit results after the checkout changes", async () => {
    const f = fixture()
    function unfinished() {
      throw new Error("Request has not started.")
    }
    let finish: (response: Response) => void = unfinished
    f.fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(context))).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    let pending: Promise<void> = Promise.resolve()
    act(() => {
      pending = f.result.current.open()
    })
    await waitFor(() => expect(f.fetchMock).toHaveBeenCalledTimes(2))
    f.rerender({ hubStatus: { ...status, branch: "prototype/other" } })
    await act(async () => {
      finish(
        new Response(JSON.stringify({ shareLinks: [link], hasMore: true, nextCursor: "next" })),
      )
      await pending
    })
    expect(f.fetchMock).toHaveBeenCalledTimes(2)
    expect(f.result.current.state.context).toBeNull()
    expect(f.result.current.state.links).toEqual([])
    expect(f.result.current.state.error).toMatch(/changed/)
  })
})

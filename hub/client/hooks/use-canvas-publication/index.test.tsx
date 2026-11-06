import { act, renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import {
  importedPrototype,
  publicationExamples,
  publicationHub,
  publicationState,
} from "@utils/resolve-prototype-publication/fixtures"
import { useCanvasPublication } from "."
import { publishPreparation } from "@utils/resolve-prototype-publication/fixtures"

function mount(overrides: Partial<Parameters<typeof useCanvasPublication>[0]> = {}) {
  vi.useFakeTimers()
  const state = structuredClone(publicationExamples["Unpublished branch"]!.state!)
  state.stats.workingTree = "clean"
  const props: Parameters<typeof useCanvasPublication>[0] = {
    token: "local",
    state,
    hubStatus: publicationHub,
    error: "",
    setError: vi.fn(),
    refresh: vi.fn<(force: boolean) => Promise<void>>().mockResolvedValue(undefined),
    refreshHub: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    ...overrides,
  }
  const fetch = vi.fn<(path: string, options?: RequestInit) => Promise<Response>>((path) =>
    Promise.resolve(
      Response.json(
        path === "/api/publish/prepare"
          ? publishPreparation(props.state!)
          : { message: "Publish requested" },
      ),
    ),
  )
  vi.stubGlobal("fetch", fetch)
  return { ...renderHook(useCanvasPublication, { initialProps: props }), props, fetch }
}

describe("useCanvasPublication()", () => {
  it("refuses a commit choice for an unchecked checkout even when called outside the disabled dialog control", async () => {
    const { result, props, fetch } = mount()
    const respond = fetch.getMockImplementation()!
    fetch.mockImplementation((path, options) =>
      path === "/api/publish/prepare"
        ? Promise.resolve(
            Response.json({
              target: publishPreparation(props.state!).target,
              workingTree: "unavailable",
              workingTreeError: "Git status timed out.",
              remember: true,
            }),
          )
        : respond(path, options),
    )
    await act(async () => result.current.publish())
    expect(result.current.publishDialog).not.toBeNull()
    await act(async () => result.current.choosePublish("commit-changes", true))
    expect(result.current.publishDialog).not.toBeNull()
    expect(fetch.mock.calls.some(([path]) => path === "/api/publish")).toBe(false)
    expect(fetch.mock.calls.some(([path]) => path === "/api/publish/preference")).toBe(false)
  })

  it("blocks preparation until a pending publishing-preference save settles", async () => {
    const { result, rerender, props, fetch } = mount({ preferenceSaving: true })
    expect(result.current.busy).toBe(true)
    await act(async () => result.current.publish())
    expect(fetch).not.toHaveBeenCalled()
    rerender({ ...props, preferenceSaving: false })
    await act(async () => result.current.publish())
    expect(fetch.mock.calls.filter(([path]) => path === "/api/publish")).toHaveLength(1)
  })

  it("blocks dispatching an existing publishing choice during a preference save", async () => {
    const { result, rerender, props, fetch } = mount({
      state: publicationExamples["Unpublished branch"]!.state!,
    })
    await act(async () => result.current.publish())
    expect(result.current.publishDialog).not.toBeNull()
    rerender({ ...props, preferenceSaving: true })
    await act(async () => result.current.choosePublish("commit-changes", true))
    expect(fetch.mock.calls.some(([path]) => path === "/api/publish")).toBe(false)
    rerender({ ...props, preferenceSaving: false })
    await act(async () => result.current.choosePublish("commit-changes", true))
    expect(fetch.mock.calls.filter(([path]) => path === "/api/publish")).toHaveLength(1)
  })

  it("does not announce an existing Build or another author's publication", async () => {
    const hub = { ...publicationHub, state: "connected" as const, prototype: importedPrototype }
    const { result, rerender, props, fetch } = mount({ state: publicationState, hubStatus: hub })
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(result.current.publication.action).toBe("none")
    rerender({
      ...props,
      hubStatus: {
        ...hub,
        prototype: {
          ...importedPrototype,
          build: {
            ...importedPrototype.build!,
            number: 2,
            author: { login: "other", name: null, avatarUrl: null },
          },
        },
      },
    })
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(result.current.publication.action).toBe("none")
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(["clean", "changed"] as const)(
    "retains verified Build evidence as newer Builds arrive with a %s checkout",
    async (workingTree) => {
      const existingBuild = { ...importedPrototype.build!, number: 7 }
      const { result, rerender, props } = mount({
        state: publicationExamples["Unpushed changes"]!.state!,
        hubStatus: {
          ...publicationHub,
          state: "connected",
          prototype: { ...importedPrototype, build: existingBuild },
        },
      })
      await act(async () => result.current.publish())
      const hub = {
        ...publicationHub,
        state: "connected" as const,
        prototype: { ...importedPrototype, build: existingBuild },
      }
      const state = {
        ...publicationState,
        stats: { ...publicationState.stats, workingTree },
      }
      rerender({ ...props, state, hubStatus: hub })
      await act(() => vi.advanceTimersByTimeAsync(0))
      expect(result.current.presentedState?.stats.publishedUrl).toBe(existingBuild.url)
      rerender({
        ...props,
        state,
        hubStatus: {
          ...hub,
          prototype: { ...importedPrototype, build: { ...existingBuild, number: 8 } },
        },
      })
      await act(() => vi.advanceTimersByTimeAsync(0))
      expect(result.current.presentedState?.stats.publishedUrl).toBe(existingBuild.url)
      expect(result.current.publication.action).toBe(workingTree === "changed" ? "publish" : "none")
    },
  )

  it.each(["matching", "advanced"] as const)(
    "checks the freshly prepared clean commit against the %s cached Build",
    async (commit) => {
      const hub = { ...publicationHub, state: "connected" as const, prototype: importedPrototype }
      const { result, props, fetch } = mount({
        state: {
          ...publicationState,
          stats: { ...publicationState.stats, workingTree: "changed" },
        },
        hubStatus: hub,
      })
      const preparation = publishPreparation({
        ...publicationState,
        stats: {
          ...publicationState.stats,
          commitSha: commit === "advanced" ? "b".repeat(40) : publicationState.stats.commitSha,
        },
      })
      const respond = fetch.getMockImplementation()!
      fetch.mockImplementation((path) =>
        path === "/api/publish/prepare"
          ? Promise.resolve(Response.json(preparation))
          : respond(path),
      )
      expect(result.current.publication.action).toBe("publish")
      await act(async () => result.current.publish())

      if (commit === "matching") {
        expect(result.current.publishDialog).toBeNull()
        expect(result.current.presentedState?.stats.publishedUrl).toBe(importedPrototype.build!.url)
        expect(fetch.mock.calls.some(([path]) => path === "/api/publish")).toBe(false)
      } else {
        expect(result.current.publishDialog).toBeNull()
        expect(fetch.mock.calls.filter(([path]) => path === "/api/publish")).toHaveLength(1)
        expect(fetch.mock.calls.find(([path]) => path === "/api/publish")?.[1]).toMatchObject({
          body: JSON.stringify({
            target: preparation.target,
            workingTree: "clean",
            mode: "committed-only",
          }),
        })
        expect(props.refreshHub).toHaveBeenCalledOnce()
        expect(props.refresh).toHaveBeenCalledWith(false)
      }
    },
  )

  it("clears a dispatch failure when the checkout changes", async () => {
    const { result, rerender, props, fetch } = mount()
    const respond = fetch.getMockImplementation()!
    fetch.mockImplementation((path) =>
      path === "/api/publish" ? Promise.reject(new Error("Copilot is offline")) : respond(path),
    )
    await act(async () => result.current.publish())
    expect(result.current.publication).toMatchObject({
      kind: "failed",
      detail: "Copilot is offline",
    })
    const state = props.state!
    rerender({
      ...props,
      state: {
        ...state,
        stats: {
          ...state.stats,
          branch: "prototype/other",
          remoteBranch: { ...state.stats.remoteBranch!, branch: "prototype/other" },
        },
      },
      hubStatus: { ...publicationHub, branch: "prototype/other" },
    })
    expect(result.current.publication.kind).toBe("unpublished")
  })
})

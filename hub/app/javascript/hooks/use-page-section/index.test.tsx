import { act, renderHook, waitFor } from "@testing-library/react"
import { NavigationContext } from "@thoughtbot/superglue"
import type { Meta } from "@thoughtbot/superglue"
import type * as Superglue from "@thoughtbot/superglue"
import type { ApplicationRemote } from "@thoughtbot/superglue"
import type { PropsWithChildren } from "react"
import { describe, expect, it, vi } from "vitest"

import { usePageSection } from "."

vi.mock("@thoughtbot/superglue", async (importOriginal) => {
  const original = await importOriginal<typeof Superglue>()
  return {
    ...original,
    useSuperglue: () => ({ currentPageKey: "/repositories/2001/prototypes/manage" }),
  }
})

function metadata(): Meta {
  const page = {
    data: {},
    componentIdentifier: "prototype_management/show",
    assets: [],
    defers: [],
    fragments: [],
    slices: {},
    renderedAt: 1,
    restoreStrategy: "revisitOnly" as const,
  }
  return {
    page,
    pageKey: "/repositories/2001/prototypes/manage",
    redirected: false,
    needsRefresh: false,
    componentIdentifier: page.componentIdentifier,
    rsp: new Response(),
    fetchArgs: ["/repositories/2001/prototypes/manage", { method: "GET" }],
  }
}

describe("usePageSection()", () => {
  it("loads independent sections without waiting for one another", async () => {
    let finishBranches!: (result: Meta) => void
    const branches = new Promise<Meta>((resolve) => {
      finishBranches = resolve
    })
    const remote = vi
      .fn<ApplicationRemote>()
      .mockImplementation((path: string) =>
        path.includes("management") ? branches : Promise.resolve(metadata()),
      )
    function Wrapper({ children }: PropsWithChildren) {
      return (
        <NavigationContext.Provider
          value={{ pageKey: "/", search: {}, navigateTo: vi.fn(), visit: vi.fn(), remote }}
        >
          {children}
        </NavigationContext.Provider>
      )
    }
    const { result } = renderHook(
      () => ({
        branches: usePageSection("/manage?props_at=data.management", "shell"),
        repositories: usePageSection("/manage?props_at=data.repositoryChoices", "shell"),
      }),
      { wrapper: Wrapper },
    )
    expect(remote).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(result.current.repositories.loading).toBe(false))
    expect(result.current.branches.loading).toBe(true)
    await act(async () => {
      finishBranches(metadata())
      await branches
    })
    expect(result.current.branches.loading).toBe(false)
    expect(result.current.branches.failed).toBe(false)
  })

  it("reports a failed branch request and retries without reloading repository choices", async () => {
    const remote = vi
      .fn<ApplicationRemote>()
      .mockRejectedValueOnce(new Error("Unavailable"))
      .mockResolvedValue(metadata())
    function Wrapper({ children }: PropsWithChildren) {
      return (
        <NavigationContext.Provider
          value={{ pageKey: "/", search: {}, navigateTo: vi.fn(), visit: vi.fn(), remote }}
        >
          {children}
        </NavigationContext.Provider>
      )
    }
    const { result } = renderHook(
      () => ({
        branches: usePageSection("/manage?props_at=data.management", "shell"),
        repositories: usePageSection("/manage?props_at=data.repositoryChoices", "shell"),
      }),
      { wrapper: Wrapper },
    )
    await waitFor(() => expect(result.current.branches.failed).toBe(true))
    await waitFor(() => expect(result.current.repositories.loading).toBe(false))
    expect(remote).toHaveBeenCalledTimes(2)
    act(() => result.current.branches.retry())
    await waitFor(() => expect(result.current.branches.loading).toBe(false))
    expect(result.current.branches.failed).toBe(false)
    expect(remote).toHaveBeenCalledTimes(3)
    expect(remote.mock.calls.filter(([path]) => path.includes("repositoryChoices"))).toHaveLength(1)
  })

  it("aborts superseded and unmounted requests and ignores late results", async () => {
    let finishFirst!: (result: Meta) => void
    const first = new Promise<Meta>((resolve) => {
      finishFirst = resolve
    })
    const remote = vi
      .fn<ApplicationRemote>()
      .mockReturnValueOnce(first)
      .mockResolvedValue(metadata())
    function Wrapper({ children }: PropsWithChildren) {
      return (
        <NavigationContext.Provider
          value={{ pageKey: "/", search: {}, navigateTo: vi.fn(), visit: vi.fn(), remote }}
        >
          {children}
        </NavigationContext.Provider>
      )
    }
    const { result, rerender, unmount } = renderHook(({ path }) => usePageSection(path, "shell"), {
      initialProps: { path: "/manage?page=1&props_at=data.management" },
      wrapper: Wrapper,
    })
    const firstSignal = remote.mock.calls[0]?.[1]?.signal
    rerender({ path: "/manage?page=2&props_at=data.management" })
    expect(firstSignal?.aborted).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => {
      finishFirst({ ...metadata(), needsRefresh: true })
      await first
    })
    expect(result.current.failed).toBe(false)
    const lastSignal = remote.mock.calls[1]?.[1]?.signal
    unmount()
    expect(lastSignal?.aborted).toBe(true)
  })
})

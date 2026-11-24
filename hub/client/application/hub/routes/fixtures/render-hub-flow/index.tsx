import type { RouteConfigEntry } from "@react-router/dev/routes"
import { act, render, waitFor } from "@testing-library/react"
import type { ComponentType } from "react"
import {
  createBrowserRouter,
  RouterProvider,
  useLoaderData,
  type ActionFunction,
  type LoaderFunction,
  type RouteObject,
  type ShouldRevalidateFunction,
} from "react-router"
import { onTestFinished } from "vitest"

import { HubThemeProvider } from "@hooks/use-hub-theme"
import type { stubHubFetch } from "@/test/stub-hub-fetch"

import routes from "../../../routes"

type RouteModule = {
  default?: ComponentType<{ loaderData: unknown }>
  clientLoader?: LoaderFunction
  clientAction?: ActionFunction
  shouldRevalidate?: ShouldRevalidateFunction
  ErrorBoundary?: ComponentType
  HydrateFallback?: ComponentType
  handle?: unknown
}

const modules = import.meta.glob<RouteModule>(
  ["../../../root.tsx", "../../**/index.tsx", "!../../fixtures/**"],
  { eager: true },
)

export async function renderHubFlow(
  api: ReturnType<typeof stubHubFetch>,
  initialEntry: string,
  { workspaceRoutes = [] }: { workspaceRoutes?: RouteObject[] } = {},
) {
  function applicationRoute(entry: RouteConfigEntry): RouteObject {
    const root = entry.file === "root.tsx"
    const module =
      modules[root ? "../../../root.tsx" : `../../${entry.file.replace(/^routes\//, "")}`]
    if (!module) throw new Error(`Missing application route module: ${entry.file}`)
    const Page = module.default
    const common = {
      id: entry.id ?? entry.file.replace(/\.tsx$/, ""),
      path: entry.path,
      loader: module.clientLoader,
      action: module.clientAction,
      shouldRevalidate: module.shouldRevalidate,
      ErrorBoundary: module.ErrorBoundary,
      HydrateFallback: module.HydrateFallback,
      handle: module.handle,
      Component: Page ? () => <Page loaderData={useLoaderData()} /> : undefined,
    }
    if (entry.index) return { ...common, index: true }
    const children = entry.children?.map(applicationRoute)
    if (entry.file === "routes/workspace-content/index.tsx") children?.unshift(...workspaceRoutes)
    return { ...common, children }
  }

  window.history.replaceState(null, "", initialEntry)
  const router = createBrowserRouter(
    [applicationRoute({ id: "root", file: "root.tsx", children: routes })],
    { window },
  )
  onTestFinished(() => router.dispose())
  await waitFor(
    () => {
      if (!router.state.initialized) throw new Error("Initial Hub route is not loaded.")
    },
    { timeout: 10_000 },
  )
  const view = render(<RouterProvider router={router} />, { wrapper: HubThemeProvider })
  onTestFinished(view.unmount)

  function idle() {
    return (
      router.state.initialized &&
      router.state.navigation.state === "idle" &&
      router.state.revalidation === "idle" &&
      [...router.state.fetchers.values()].every((fetcher) => fetcher.state === "idle") &&
      api.pending.size === 0
    )
  }
  async function settle(action?: () => unknown) {
    await act(async () => {
      await action?.()
    })
    await waitFor(
      () => {
        if (!idle()) {
          const pending = [...api.pending].map(({ method, url }) => `${method} ${url}`)
          throw new Error(`Hub is not idle (pending requests: ${pending.join(", ")}).`)
        }
      },
      { timeout: 10_000 },
    )
  }
  async function go(delta: number) {
    const previousKey = router.state.location.key
    await act(() => router.navigate(delta))
    await waitFor(() => {
      if (router.state.location.key === previousKey)
        throw new Error("History entry did not change.")
    })
    await settle()
  }
  await settle()
  return Object.assign(router, { settle, go })
}

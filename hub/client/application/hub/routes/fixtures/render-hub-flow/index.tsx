import { act, render } from "@testing-library/react"
import type { setupServer } from "msw/node"
import { createBrowserRouter, RouterProvider, type RouteObject } from "react-router"
import { onTestFailed, onTestFinished, vi } from "vitest"

import { HubThemeProvider } from "@hooks/use-hub-theme"
import * as hubApi from "@application/hub/bootstrap-hub-api"
import { clientLoader as loadSession, ErrorBoundary, HydrateFallback } from "@application/hub/root"
import { clientLoader as loadBuildHistory } from "@application/hub/routes/build-history"
import { clientLoader as loadHome } from "@application/hub/routes/home"
import {
  clientAction as savePrototype,
  clientLoader as loadPrototype,
} from "@application/hub/routes/prototype"
import { clientLoader as loadRepository } from "@application/hub/routes/repository"
import { clientAction as changeSession } from "@application/hub/routes/session"
import SignInRoute, { clientLoader as loadSignIn } from "@application/hub/routes/sign-in"
import { clientLoader as loadWorkspace } from "@application/hub/routes/workspace"

import { RootComponent } from "./root-component"
import { ErrorWithTools } from "./error-with-tools"
import { WorkspaceComponent } from "./workspace-component"
import { HomeComponent } from "./home-component"
import { RepositoryComponent } from "./repository-component"
import { PrototypeComponent } from "./prototype-component"
import { BuildHistoryComponent } from "./build-history-component"
import { readTestRouteParameter } from "./read-test-route-parameter"

export async function renderHubFlow(
  server: ReturnType<typeof setupServer>,
  initialEntry: string,
  {
    publicRoutes = [],
    workspaceRoutes = [],
    withTools = false,
  }: { publicRoutes?: RouteObject[]; workspaceRoutes?: RouteObject[]; withTools?: boolean } = {},
) {
  vi.stubEnv("DEV", true)
  vi.stubEnv("MODE", "mock")
  vi.spyOn(hubApi, "bootstrapHubApi").mockResolvedValue(undefined)
  server.listen({ onUnhandledRequest: "error" })
  const pendingRequests = new Map<string, string>()
  const pendingAbortListeners = new Map<string, { signal: AbortSignal; abort: () => void }>()
  const idleListeners = new Set<() => void>()
  let disposed = false
  function notify() {
    idleListeners.forEach((listener) => listener())
  }
  function finishRequest(requestId: string) {
    const pending = pendingAbortListeners.get(requestId)
    if (pending) pending.signal.removeEventListener("abort", pending.abort)
    pendingAbortListeners.delete(requestId)
    pendingRequests.delete(requestId)
    notify()
  }
  server.events.on("request:start", ({ request, requestId }) => {
    pendingRequests.set(requestId, `${request.method} ${request.url}`)
    if (request.signal.aborted) {
      finishRequest(requestId)
      return
    }
    function abort() {
      finishRequest(requestId)
    }
    pendingAbortListeners.set(requestId, { signal: request.signal, abort })
    request.signal.addEventListener("abort", abort, { once: true })
    notify()
  })
  server.events.on("request:end", ({ requestId }) => {
    finishRequest(requestId)
  })
  window.history.replaceState(null, "", initialEntry)
  const router = createBrowserRouter(
    [
      {
        id: "root",
        loader: loadSession,
        Component: () => <RootComponent withTools={withTools} />,
        ErrorBoundary: withTools ? ErrorWithTools : ErrorBoundary,
        HydrateFallback,
        children: [
          { index: true, loader: loadHome, Component: HomeComponent },
          { path: "repositories", loader: loadHome, Component: HomeComponent },
          { path: "sign-in", loader: loadSignIn, Component: SignInRoute },
          { path: "session", action: changeSession },
          ...publicRoutes,
          {
            id: "routes/workspace/index",
            loader: loadWorkspace,
            Component: WorkspaceComponent,
            children: [
              {
                path: "/repositories/:repositoryId",
                loader: ({ request, params }) =>
                  loadRepository({
                    request,
                    params: { repositoryId: readTestRouteParameter(params, "repositoryId") },
                  }),
                Component: RepositoryComponent,
              },
              {
                path: "/repositories/:repositoryId/prototypes/:prototypeId",
                loader: ({ request, params }) =>
                  loadPrototype({
                    request,
                    params: {
                      repositoryId: readTestRouteParameter(params, "repositoryId"),
                      prototypeId: readTestRouteParameter(params, "prototypeId"),
                    },
                  }),
                action: ({ request, params }) =>
                  savePrototype({
                    request,
                    params: {
                      repositoryId: readTestRouteParameter(params, "repositoryId"),
                      prototypeId: readTestRouteParameter(params, "prototypeId"),
                    },
                  }),
                Component: PrototypeComponent,
              },
              {
                path: "/repositories/:repositoryId/prototypes/:prototypeId/builds",
                loader: ({ request, params }) =>
                  loadBuildHistory({
                    request,
                    params: {
                      repositoryId: readTestRouteParameter(params, "repositoryId"),
                      prototypeId: readTestRouteParameter(params, "prototypeId"),
                    },
                  }),
                Component: BuildHistoryComponent,
              },
              ...workspaceRoutes,
            ],
          },
        ],
      },
    ],
    { window },
  )
  function idle() {
    return (
      router.state.initialized &&
      router.state.navigation.state === "idle" &&
      router.state.revalidation === "idle" &&
      [...router.state.fetchers.values()].every((fetcher) => fetcher.state === "idle") &&
      pendingRequests.size === 0
    )
  }
  function waitUntilIdle(ready: () => boolean) {
    return new Promise<void>((resolve) => {
      function check() {
        if (!disposed && (!idle() || !ready())) return
        idleListeners.delete(check)
        resolve()
      }
      idleListeners.add(check)
      check()
    })
  }
  async function settle(action?: () => unknown, ready: () => boolean = () => true) {
    if (action) {
      await act(async () => {
        await action()
      })
    }
    // Committing a route can start the review transport outside React Router.
    do {
      await act(async () => {
        await waitUntilIdle(ready)
      })
    } while (!disposed && (!idle() || !ready()))
  }
  async function go(delta: number) {
    const previousKey = router.state.location.key
    await settle(
      () => router.navigate(delta),
      () => router.state.location.key !== previousKey,
    )
  }
  const unsubscribe = router.subscribe(notify)
  onTestFailed(() => {
    process.stderr.write(
      "Hub flow failure state: " +
        JSON.stringify({
          initialized: router.state.initialized,
          location: router.state.location.pathname + router.state.location.search,
          navigation: router.state.navigation.state,
          revalidation: router.state.revalidation,
          fetchers: [...router.state.fetchers].map(([key, fetcher]) => ({
            key,
            state: fetcher.state,
            action: fetcher.formAction,
          })),
          pendingRequests: [...pendingRequests.values()],
          errors: Object.fromEntries(
            Object.entries(router.state.errors ?? {}).map(([id, error]) => [
              id,
              error instanceof Error ? error.message : String(error),
            ]),
          ),
        }) +
        "\n",
    )
  })
  const view = render(<RouterProvider router={router} />, { wrapper: HubThemeProvider })
  function close() {
    if (disposed) return
    view.unmount()
    router.dispose()
    unsubscribe()
    disposed = true
    pendingAbortListeners.forEach(({ signal, abort }) => signal.removeEventListener("abort", abort))
    pendingAbortListeners.clear()
    pendingRequests.clear()
    notify()
    server.close()
  }
  onTestFinished(close)
  await settle()
  return Object.assign(router, { settle, go, close })
}

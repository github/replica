import { createRoute, createRouter } from "@tanstack/react-router"

import { AboutRoutePage } from "@routes/about/about-route-page"
import { activityRoute } from "@routes/activity/route"
import { HomeRoutePage } from "@routes/home/home-route-page"

import { rootRoute } from "./root-route"
import { createPrototypeHistory } from "./create-prototype-history"
// --- end scaffold:imports ---

export const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomeRoutePage,
})

export const aboutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/about",
  component: AboutRoutePage,
})

const routeTree = rootRoute.addChildren([
  homeRoute,
  aboutRoute,
  activityRoute,
  // --- end scaffold:app-routes ---
])

export function createAppRouter(history = createPrototypeHistory()) {
  return createRouter({
    routeTree,
    history,
    defaultPreload: "intent",
  })
}

export const router = createAppRouter()

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}

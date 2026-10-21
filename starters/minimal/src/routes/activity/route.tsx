import { createRoute, lazyRouteComponent } from "@tanstack/react-router"

import { rootRoute as appParentRoute } from "@app/root-route"

import { load } from "./loader"

const ActivityRoutePage = lazyRouteComponent(
  () => import("./activity-route-page"),
  "ActivityRoutePage",
)

export const activityRoute = createRoute({
  getParentRoute: () => appParentRoute,
  path: "activity",
  loader: load,
  component: ActivityRoutePage,
})

export const activityStartPage = "/activity"

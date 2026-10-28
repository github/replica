import { createRoute, lazyRouteComponent } from "@tanstack/react-router"

import { rootRoute as appParentRoute } from "@app/root-route"

import { load } from "./loader"

const __SCAFFOLD_PASCAL__RoutePage = lazyRouteComponent(
  () => import("./__SCAFFOLD_SLUG__-route-page"),
  "__SCAFFOLD_PASCAL__RoutePage",
)

export const __SCAFFOLD_CAMEL__Route = createRoute({
  getParentRoute: () => appParentRoute,
  path: __SCAFFOLD_ROUTE_PATH__,
  loader: load,
  component: __SCAFFOLD_PASCAL__RoutePage,
})

export const __SCAFFOLD_CAMEL__StartPage = __SCAFFOLD_START_PAGE__

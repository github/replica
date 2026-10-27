import { createRootRoute, Outlet } from "@tanstack/react-router"

import { NotFoundRoutePage } from "./not-found-route-page"

export const rootRoute = createRootRoute({
  component: () => <Outlet />,
  notFoundComponent: NotFoundRoutePage,
})

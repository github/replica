import { index, layout, prefix, route } from "@react-router/dev/routes"
import type { RouteConfig } from "@react-router/dev/routes"
import { repositoryProductRoutes, workspaceProductRoutes } from "./routes/product-routes"
import { standaloneSetupRoutes, workspaceSettingsRoutes } from "./routes/settings-routes"

export default [
  route("admin-enrollment", "routes/admin-enrollment/index.tsx"),
  route("signed-in/no-access", "routes/no-repository-access/index.tsx"),
  route("sign-in", "routes/sign-in/index.tsx"),
  route("session", "routes/session/index.tsx"),
  route("canvas/pair/:userCode", "routes/canvas-pairing/index.tsx"),
  route("shared/:shareId", "routes/product-public/index.tsx"),
  ...standaloneSetupRoutes,
  layout("routes/workspace/index.tsx", [
    layout("routes/workspace-content/index.tsx", [
      index("routes/home/index.tsx"),
      route("repositories", "routes/repositories/index.tsx"),
      ...prefix("repositories/:repositoryId", repositoryProductRoutes),
      route("notifications", "routes/settings-notifications/index.tsx"),
      route("welcome", "routes/settings-welcome/index.tsx"),
      route("canvas/connections", "routes/canvas-connections/index.tsx"),
      ...workspaceProductRoutes,
      ...workspaceSettingsRoutes,
      route("*", "routes/not-found/index.tsx"),
    ]),
  ]),
] satisfies RouteConfig

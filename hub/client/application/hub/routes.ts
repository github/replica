import { index, layout, route } from "@react-router/dev/routes"
import type { RouteConfig } from "@react-router/dev/routes"
import { productPublicRoutes, productWorkspaceRoutes } from "./routes/product-routes"
import { settingsPublicRoutes, settingsWorkspaceRoutes } from "./routes/settings-routes"

export default [
  index("routes/home/index.tsx"),
  route("admin-enrollment", "routes/admin-enrollment/index.tsx"),
  route("sign-in", "routes/sign-in/index.tsx"),
  route("session", "routes/session/index.tsx"),
  route("repositories", "routes/repositories/index.tsx"),
  route("settings/administrators", "routes/settings-administrators/index.tsx"),
  route("settings/administrators/confirm", "routes/settings-administrator-authorization/index.tsx"),
  route("settings/sessions/confirm", "routes/settings-session-revocation-authorization/index.tsx"),
  route(
    "settings/administrators/:membershipId/:operation",
    "routes/settings-administrator-confirmation/index.tsx",
  ),
  ...productPublicRoutes,
  ...settingsPublicRoutes,
  layout("routes/workspace/index.tsx", [
    ...productWorkspaceRoutes,
    ...settingsWorkspaceRoutes,
    route("repositories/:repositoryId", "routes/repository/index.tsx"),
    route("repositories/:repositoryId/prototypes/:prototypeId", "routes/prototype/index.tsx"),
    route(
      "repositories/:repositoryId/prototypes/:prototypeId/builds",
      "routes/build-history/index.tsx",
    ),
    route(
      "repositories/:repositoryId/prototypes/:prototypeId/builds/:buildNumber",
      "routes/build/index.tsx",
    ),
  ]),
  route("*", "routes/not-found/index.tsx"),
] satisfies RouteConfig

import { route } from "@react-router/dev/routes"
import type { RouteConfigEntry } from "@react-router/dev/routes"

export const repositoryProductRoutes: RouteConfigEntry[] = [
  route("", "routes/repository/index.tsx"),
  route("new", "routes/product-new/index.tsx"),
  route("templates/:templateId", "routes/product-browse/index.tsx"),
  route("prototypes/manage", "routes/product-management/index.tsx"),
  route("prototypes/:prototypeId", "routes/prototype/index.tsx"),
  route("prototypes/:prototypeId/builds", "routes/build-history/index.tsx"),
  route("prototypes/:prototypeId/share-links", "routes/product-share-links/index.tsx"),
  route("analytics", "routes/settings-analytics/index.tsx"),
  route("learnings", "routes/settings-learnings/index.tsx"),
  route("learnings/agents", "routes/learning-agents/index.tsx"),
]

export const workspaceProductRoutes: RouteConfigEntry[] = [
  route("settings/sharing", "routes/product-sharing-settings/index.tsx"),
  route("admin/sharing", "routes/legacy-sharing/index.tsx"),
]

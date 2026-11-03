import { route } from "@react-router/dev/routes"
import type { RouteConfigEntry } from "@react-router/dev/routes"

export const productWorkspaceRoutes: RouteConfigEntry[] = [
  route("repositories/:repositoryId/new", "routes/product-new/index.tsx"),
  route("repositories/:repositoryId/templates/:templateId", "routes/product-browse/index.tsx"),
  route("repositories/:repositoryId/prototypes/manage", "routes/product-management/index.tsx"),
  route(
    "repositories/:repositoryId/prototypes/:prototypeId/share-links",
    "routes/product-share-links/index.tsx",
  ),
  route("admin/sharing", "routes/product-sharing-settings/index.tsx"),
]

export const productPublicRoutes: RouteConfigEntry[] = [
  route("shared/:shareId", "routes/product-public/index.tsx"),
]

import { index, route } from "@react-router/dev/routes"
import type { RouteConfig } from "@react-router/dev/routes"

export default [
  index("routes/home/index.tsx"),
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
  route("*", "routes/not-found/index.tsx"),
] satisfies RouteConfig

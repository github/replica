import type { Express } from "express"

import { get as handleApiHealthGet } from "./api/health/get/index.ts"
import { get as createGitHubCallbackGet } from "./api/auth/github/callback/get/index.ts"
import { post as createGitHubStartPost } from "./api/auth/github/start/post/index.ts"
import type { RouteDependencies } from "./types.ts"

/** Keep endpoint registration separate from the app's shared middleware. */
export function routes(app: Express, dependencies: RouteDependencies = {}): void {
  app.get("/api/health", handleApiHealthGet)
  if (dependencies?.githubAuthentication) {
    app.post("/api/auth/github/start", createGitHubStartPost(dependencies.githubAuthentication))
    app.get("/api/auth/github/callback", createGitHubCallbackGet(dependencies.githubAuthentication))
  }
}

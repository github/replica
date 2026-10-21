import { defineConfig } from "vitest/config"

import { viteAliases } from "./vite-aliases.ts"

export default defineConfig({
  resolve: { alias: viteAliases },
  test: {
    environment: "jsdom",
  },
})

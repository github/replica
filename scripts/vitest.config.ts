import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/index.test.ts"],
    testTimeout: 30_000,
    clearMocks: true,
    mockReset: true,
    restoreMocks: true,
    unstubGlobals: true,
  },
})

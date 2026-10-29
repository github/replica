import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    clearMocks: true,
    mockReset: true,
    restoreMocks: true,
    unstubGlobals: true,
    environment: "node",
    include: ["scripts/*/index.test.ts"],
    setupFiles: ["./test/setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
  },
})

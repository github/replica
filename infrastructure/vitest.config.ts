import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "installer/**/*.test.ts",
      "installer/**/*.test.tsx",
      "azure/install/**/*.test.ts",
      "terraform/**/*.test.ts",
    ],
    restoreMocks: true,
    unstubEnvs: true,
    testTimeout: 30_000,
  },
})

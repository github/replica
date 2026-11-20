import { configDefaults, defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "installer/**/*.test.ts",
      "installer/**/*.test.tsx",
      "azure/install/**/*.test.ts",
      "azure/post/**/*.test.ts",
      "terraform/**/*.test.ts",
    ],
    exclude: [...configDefaults.exclude, "installer/command/describe/index.test.ts"],
    restoreMocks: true,
    unstubEnvs: true,
    testTimeout: process.platform === "win32" ? 120_000 : 30_000,
  },
})

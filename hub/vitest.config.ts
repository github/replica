import { availableParallelism } from "node:os"
import react from "@vitejs/plugin-react"
import { configDefaults, defineConfig } from "vitest/config"

import { viteAliases } from "./vite-aliases.ts"

const nodeTests = [
  ".storybook/analyze-usage/index.test.ts",
  ".storybook/main.test.ts",
  "client/utils/create-byte-limited-string-schema/index.test.ts",
  "client/utils/create-preview-prototype-prompt/index.test.ts",
  "client/utils/create-prototype-submission/index.test.ts",
  "client/utils/get-area-anchor-geometry/index.test.ts",
  "client/utils/get-mention-logins/index.test.ts",
  "client/utils/get-preview-frame-url/index.test.ts",
  "client/utils/get-review-thread-participants/index.test.ts",
  "client/utils/group-review-comments-into-threads/index.test.ts",
  "client/utils/is-within-hover-corridor/index.test.ts",
  "client/utils/read-rate-limit-error/index.test.ts",
  "client/utils/review-thread-matches-filters/index.test.ts",
  "client/application/prototype-canvas/tests/is-hub-status-request/index.test.ts",
  "client/application/prototype-canvas/tests/sharing-fixture/index.test.ts",
  "client/components/prototype-controls-fields/numeric-input-width/index.test.ts",
  "client/components/prototype-controls-panel/panel-width/index.test.ts",
  "client/utils/present-prototype-state/index.test.ts",
  "client/utils/prototype-canvas-request/index.test.ts",
  "client/utils/resolve-prototype-publication/index.test.ts",
  "client/utils/resolve-prototype-share-readiness/index.test.ts",
]

export default defineConfig({
  plugins: [react()],
  resolve: { alias: viteAliases, dedupe: ["react", "react-dom"] },
  test: {
    clearMocks: true,
    css: true,
    globals: true,
    pool: "forks",
    fileParallelism: true,
    maxWorkers: Math.max(1, availableParallelism() - 1),
    maxConcurrency: 1,
    mockReset: true,
    restoreMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
    setupFiles: ["./test/setup.ts"],
    server: { deps: { inline: [/@primer\//] } },
    projects: [
      {
        name: "node",
        environment: "node",
        include: [...nodeTests, "server/**/*.test.{ts,tsx}", "test/**/*.test.{ts,tsx}"],
        exclude: [],
        setupFiles: [],
      },
      {
        name: "browser",
        environment: "jsdom",
        include: ["client/**/*.test.{ts,tsx}", ".storybook/**/*.test.{ts,tsx}"],
        exclude: nodeTests,
        setupFiles: ["./client/test/setup.ts"],
      },
    ].flatMap(({ name, ...environment }) =>
      [false, true].map((database) => ({
        extends: true,
        test: {
          ...environment,
          name: database ? `${name}-database` : name,
          include: environment.include.map((pattern) =>
            database ? pattern.replace(".test.", ".db.test.") : pattern,
          ),
          exclude: [
            ...configDefaults.exclude,
            ...environment.exclude.map((pattern) =>
              database ? pattern.replace(".test.", ".db.test.") : pattern,
            ),
            ...(database ? [] : ["**/*.db.test.{ts,tsx}"]),
          ],
          setupFiles: [
            ...environment.setupFiles,
            ...(database ? ["./test/database/setup.ts"] : []),
          ],
          ...(database
            ? {
                globalSetup: ["./test/database/global-setup/index.ts"],
                hookTimeout: 30_000,
              }
            : {}),
        },
      })),
    ),
  },
})

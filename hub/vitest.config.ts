import react from "@vitejs/plugin-react"
import { configDefaults, defineConfig } from "vitest/config"

import { viteAliases } from "./vite-aliases.ts"

const nodeTests = [
  ".storybook/analyze-usage/index.test.ts",
  "app/javascript/utils/create-byte-limited-string-schema/index.test.ts",
  "app/javascript/utils/create-preview-prototype-prompt/index.test.ts",
  "app/javascript/utils/create-prototype-submission/index.test.ts",
  "app/javascript/utils/get-area-anchor-geometry/index.test.ts",
  "app/javascript/utils/get-mention-logins/index.test.ts",
  "app/javascript/utils/get-preview-frame-url/index.test.ts",
  "app/javascript/utils/get-review-thread-participants/index.test.ts",
  "app/javascript/utils/group-review-comments-into-threads/index.test.ts",
  "app/javascript/utils/is-within-hover-corridor/index.test.ts",
  "app/javascript/utils/read-rate-limit-error/index.test.ts",
  "app/javascript/utils/review-thread-matches-filters/index.test.ts",
  "app/javascript/application/prototype-canvas/tests/is-hub-status-request/index.test.ts",
  "app/javascript/application/prototype-canvas/tests/sharing-fixture/index.test.ts",
  "app/javascript/components/prototype-controls-fields/numeric-input-width/index.test.ts",
  "app/javascript/components/prototype-controls-panel/panel-width/index.test.ts",
  "app/javascript/utils/present-prototype-state/index.test.ts",
  "app/javascript/utils/prototype-canvas-request/index.test.ts",
  "app/javascript/utils/resolve-prototype-publication/index.test.ts",
  "app/javascript/utils/resolve-prototype-share-readiness/index.test.ts",
]

export default defineConfig({
  plugins: [react()],
  resolve: { alias: viteAliases, dedupe: ["react", "react-dom"] },
  test: {
    clearMocks: true,
    css: true,
    globals: true,
    mockReset: true,
    restoreMocks: true,
    unstubGlobals: true,
    server: { deps: { inline: [/@primer\//] } },
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: [...nodeTests, "server/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "browser",
          environment: "jsdom",
          include: ["app/javascript/**/*.test.{ts,tsx}", ".storybook/**/*.test.{ts,tsx}"],
          exclude: [...configDefaults.exclude, ...nodeTests],
          setupFiles: ["./app/javascript/test/setup.ts"],
        },
      },
    ],
  },
})

import js from "@eslint/js"
import { defineConfig } from "eslint/config"
import prettier from "eslint-config-prettier"
import reactHooks from "eslint-plugin-react-hooks"
import reactRefresh from "eslint-plugin-react-refresh"
import globals from "globals"
import tseslint from "typescript-eslint"

const REACT_HOOKS_PLUGIN = { meta: reactHooks.meta, rules: reactHooks.rules }
const REACT_REFRESH_PLUGIN = { rules: reactRefresh.rules }

export default defineConfig(
  {
    ignores: [
      "**/.local/**",
      "**/*.js",
      "app/views/pwa/**",
      "coverage/**",
      "node_modules/**",
      "public/**",
      "storage/**",
      "**/replica-prototype/assets/**",
      "**/prototype-controls/controls-shape.cjs",
      "**/learning/src/contracts-validators.cjs",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ["**/*.{ts,tsx,mts}", "../.github/extensions/replica-prototype/**/*.mts"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: {
      "react-hooks": REACT_HOOKS_PLUGIN,
      "react-refresh": REACT_REFRESH_PLUGIN,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-deprecated": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "func-style": ["error", "declaration"],
      quotes: ["error", "double", { avoidEscape: true }],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      semi: ["error", "never"],
    },
  },
  {
    files: ["app/javascript/application/build-visit-and-remote/index.ts"],
    rules: { "func-style": "off" },
  },
  {
    files: ["../.github/extensions/replica-prototype/validate-controls/index.mts"],
    // Diagnostic text deliberately coerces values before bounding and sanitizing them.
    rules: { "@typescript-eslint/no-base-to-string": "off" },
  },
  {
    files: ["app/javascript/pages/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@application/*", "@pages/*"],
              message: "Pages cannot depend on application setup or sibling pages.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["app/javascript/**/stories.tsx"],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
  {
    files: ["app/javascript/application/start-prototype-canvas/index.tsx"],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
  {
    files: ["app/javascript/{components,hooks,utils}/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@application/*", "@features/*", "@pages/*"],
              message: "Shared code cannot depend on higher interface layers.",
            },
          ],
        },
      ],
    },
  },
  {
    ...tseslint.configs.disableTypeChecked,
    files: [
      "vite.prototype-canvas.config.mjs",
      "script/**/*.mjs",
      "test/**/*.mjs",
      "../.github/extensions/replica-prototype/**/*.mjs",
      "../.github/extensions/replica-prototype/**/*.d.mts",
      "../.github/extensions/replica-prototype/**/*.d.ts",
      "app/javascript/utils/prototype-controls/**/*.mjs",
      "app/javascript/utils/prototype-controls/**/*.d.mts",
      "../packages/learning/**/*.mjs",
      "../packages/learning/**/*.d.mts",
    ],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { program: null, project: false, projectService: false },
    },
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      "func-style": ["error", "declaration"],
      quotes: ["error", "double", { avoidEscape: true }],
      semi: ["error", "never"],
    },
  },
  prettier,
)

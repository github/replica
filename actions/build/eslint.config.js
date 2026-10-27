import js from "@eslint/js"
import { defineConfig } from "eslint/config"
import prettier from "eslint-config-prettier"
import globals from "globals"
import tseslint from "typescript-eslint"

export default defineConfig(
  {
    ignores: ["node_modules/**", "test/fixture/dist/**"],
  },
  js.configs.recommended,
  {
    files: ["**/*.ts"],
    extends: [tseslint.configs.recommended],
  },
  {
    files: ["**/*.{mjs,ts}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      "func-style": ["error", "declaration"],
      quotes: ["error", "double", { avoidEscape: true }],
      semi: ["error", "never"],
    },
  },
  prettier,
)

import js from "@eslint/js"
import github from "eslint-plugin-github"
import reactHooks from "eslint-plugin-react-hooks"
import globals from "globals"
import tseslint from "typescript-eslint"

export default [
  { ignores: ["dist/**", "coverage/**", "scaffold-templates/**"] },
  js.configs.recommended,
  github.getFlatConfigs().recommended,
  { ...github.getFlatConfigs().browser, files: ["src/**/*.{ts,tsx}"] },
  { ...github.getFlatConfigs().react, files: ["src/**/*.tsx"] },
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: "latest",
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      "i18n-text/no-en": "off",
      "github/filenames-match-regex": ["error", "^[a-z0-9-]+(?:\\.[a-z0-9-]+)*$"],
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "import/no-unresolved": "off",
      "import/extensions": ["error", "never", { json: "always", ts: "ignore" }],
    },
  },
  {
    files: ["eslint.config.mjs"],
    rules: { "import/no-unresolved": ["error", { ignore: ["^typescript-eslint$"] }] },
  },
  {
    files: ["scripts/**"],
    rules: { "no-console": "off" },
  },
]

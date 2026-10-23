import { basename, extname, resolve } from "node:path"

import type { StorybookConfig } from "@storybook/react-vite"
import { mergeConfig, type Plugin } from "vite"

import { viteAliases } from "../vite-aliases.ts"
import { usagePlugin } from "./usage-plugin/index.ts"
import {
  controlsValidatorPlugin,
  controlsValidatorModule,
  controlsValidatorPath,
} from "../controls-validator-plugin.ts"

const config = {
  staticDirs: [
    { from: "./preview-fixtures", to: "/prototype-preview" },
    { from: "./preview-fixtures/build-controls-definitions", to: "/" },
  ],
  stories: [
    "../app/javascript/application/**/stories.tsx",
    "../app/javascript/components/**/stories.tsx",
    "../app/javascript/features/**/stories.tsx",
    "../app/javascript/pages/**/stories.tsx",
    "../app/javascript/storybook/**/stories.tsx",
  ],
  addons: ["@storybook/addon-docs", "@storybook/addon-a11y"],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  docs: {
    defaultName: "Documentation",
  },
  core: {
    disableWhatsNewNotifications: true,
  },
  features: {
    sidebarOnboardingChecklist: false,
  },
  viteFinal(config) {
    return mergeConfig(config, {
      base: "./",
      plugins: [
        usagePlugin(resolve(import.meta.dirname, "..")),
        controlsValidatorPlugin(),
        {
          name: "storybook:rolldown-entry-names",
          enforce: "post",
          config(config, { command }) {
            const rolldownOptions = config.build?.rolldownOptions
            const input = rolldownOptions?.input

            if (command !== "build" || !rolldownOptions || !input) return

            // Rolldown cannot derive [name] from Storybook's path-based names.
            let inputPaths: string[]

            if (typeof input === "string") {
              inputPaths = [input]
            } else if (Array.isArray(input)) {
              inputPaths = input
            } else {
              inputPaths = Object.values(input)
            }

            rolldownOptions.input = Object.fromEntries(
              inputPaths.map((inputPath) => [basename(inputPath, extname(inputPath)), inputPath]),
            )
          },
        } satisfies Plugin,
      ],
      resolve: {
        dedupe: ["react", "react-dom"],
        alias: {
          ...viteAliases,
          [controlsValidatorModule]: controlsValidatorPath,
        },
      },
      optimizeDeps: { include: [controlsValidatorModule] },
      server: { allowedHosts: true },
    })
  },
} satisfies StorybookConfig

export default config

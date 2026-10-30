import { reactRouter } from "@react-router/dev/vite"
import { defineConfig } from "vite"

import { viteAliases } from "./vite-aliases.ts"
import { mockAssetsPlugin } from "./mock-assets-plugin.ts"
import {
  controlsValidatorPlugin,
  controlsValidatorModule,
  controlsValidatorPath,
} from "./controls-validator-plugin.ts"

export default defineConfig(({ mode }) => ({
  plugins: [
    reactRouter(),
    controlsValidatorPlugin(),
    ...(mode === "mock" ? [mockAssetsPlugin()] : []),
  ],
  ssr: {
    noExternal: ["@primer/react-brand", "@primer/octicons-react"],
    optimizeDeps: {
      include: ["@primer/react-brand", "@primer/octicons-react", controlsValidatorModule],
      exclude: ["react", "react-dom"],
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:3001" },
  },
  preview: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:3001" },
  },
  resolve: { alias: { ...viteAliases, [controlsValidatorModule]: controlsValidatorPath } },
  optimizeDeps: { include: [controlsValidatorModule] },
}))

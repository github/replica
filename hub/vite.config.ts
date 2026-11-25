import { reactRouter } from "@react-router/dev/vite"
import { defineConfig } from "vite"

import { viteAliases } from "./vite-aliases.ts"
import {
  controlsValidatorPlugin,
  controlsValidatorModule,
  controlsValidatorPath,
} from "./controls-validator-plugin.ts"

export default defineConfig({
  plugins: [reactRouter(), controlsValidatorPlugin()],
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
    proxy: { "/api": { target: "http://127.0.0.1:3001", ws: true } },
  },
  preview: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": { target: "http://127.0.0.1:3001", ws: true } },
  },
  resolve: { alias: { ...viteAliases, [controlsValidatorModule]: controlsValidatorPath } },
  optimizeDeps: { include: [controlsValidatorModule] },
})

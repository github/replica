import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

import { viteAliases } from "./vite-aliases.ts"
import {
  controlsValidatorPlugin,
  controlsValidatorModule,
  controlsValidatorPath,
} from "./controls-validator-plugin.ts"

export default defineConfig({
  plugins: [react(), controlsValidatorPlugin()],
  build: { outDir: "dist/client" },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": { target: "http://127.0.0.1:3001", ws: true } },
  },
  resolve: { alias: { ...viteAliases, [controlsValidatorModule]: controlsValidatorPath } },
  optimizeDeps: { include: [controlsValidatorModule] },
})

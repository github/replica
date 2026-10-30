import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { viteAliases } from "./vite-aliases.ts"

export default defineConfig({
  root: new URL(".", import.meta.url).pathname,
  publicDir: false,
  base: "/assets/",
  plugins: [react()],
  resolve: { alias: viteAliases },
  build: {
    emptyOutDir: true,
    minify: true,
    cssCodeSplit: false,
    outDir: "../.github/extensions/replica-prototype/assets",
    rollupOptions: {
      input: "app/application/start-prototype-canvas/index.tsx",
      output: {
        assetFileNames: (asset) =>
          asset.names.some((name) => name.endsWith(".woff2"))
            ? "[name][extname]"
            : "renderer.[ext]",
        codeSplitting: {
          groups: [
            {
              name: "improvement-notes-prototype",
              test: /app[\\/]features[\\/]prototype-canvas-improvement-notes[\\/]/,
              priority: 5,
              includeDependenciesRecursively: false,
            },
            {
              name: "improvement-notes-vendor",
              test: /node_modules[\\/]react-dom[\\/](?:server[.-]|cjs[\\/]react-dom-server)/,
              priority: 10,
              includeDependenciesRecursively: false,
            },
            { name: "vendor", test: /node_modules/ },
          ],
        },
        chunkFileNames: "renderer-[name].js",
        entryFileNames: "renderer.js",
      },
    },
  },
})

import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { normalizePath, type Plugin } from "vite"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "./app/utils/prototype-controls")
export const controlsValidatorModule = "replica-controls-validator"
export const controlsValidatorPath = resolve(root, "controls-shape.cjs")
const validationPath = normalizePath(resolve(root, "controls-validation.mjs"))

export function controlsValidatorPlugin(): Plugin {
  return {
    name: "replica:controls-validator",
    enforce: "pre",
    resolveId(source, importer, options) {
      const importerPath = importer?.split("?")[0]
      if (
        source !== "./controls-shape.cjs" ||
        !importerPath ||
        normalizePath(importerPath) !== validationPath
      )
        return null
      return this.resolve(controlsValidatorModule, importer, { ...options, skipSelf: true })
    },
  }
}

import { fileURLToPath, URL } from "node:url"

export const viteAliases = {
  "@app": fileURLToPath(new URL("./src/app", import.meta.url)),
  "@routes": fileURLToPath(new URL("./src/routes", import.meta.url)),
  "@data": fileURLToPath(new URL("./src/data", import.meta.url)),
}

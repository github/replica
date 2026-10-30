import { fileURLToPath, URL } from "node:url"

export const viteAliases = {
  "@": fileURLToPath(new URL("./app", import.meta.url)),
  "@application": fileURLToPath(new URL("./app/application", import.meta.url)),
  "@components": fileURLToPath(new URL("./app/components", import.meta.url)),
  "@features": fileURLToPath(new URL("./app/features", import.meta.url)),
  "@hooks": fileURLToPath(new URL("./app/hooks", import.meta.url)),
  "@pages": fileURLToPath(new URL("./app/pages", import.meta.url)),
  "@utils": fileURLToPath(new URL("./app/utils", import.meta.url)),
}

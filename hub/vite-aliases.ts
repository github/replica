import { fileURLToPath, URL } from "node:url"

export const viteAliases = {
  "@": fileURLToPath(new URL("./client", import.meta.url)),
  "@application": fileURLToPath(new URL("./client/application", import.meta.url)),
  "@assets": fileURLToPath(new URL("./public", import.meta.url)),
  "@components": fileURLToPath(new URL("./client/components", import.meta.url)),
  "@features": fileURLToPath(new URL("./client/features", import.meta.url)),
  "@hooks": fileURLToPath(new URL("./client/hooks", import.meta.url)),
  "@pages": fileURLToPath(new URL("./client/pages", import.meta.url)),
  "@utils": fileURLToPath(new URL("./client/utils", import.meta.url)),
  "@replica-extension": fileURLToPath(
    new URL("../.github/extensions/replica-prototype", import.meta.url),
  ),
}

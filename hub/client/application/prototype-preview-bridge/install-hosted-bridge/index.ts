import { installBridge } from ".."

export function installHostedBridge(origin: string, basePath: string) {
  installBridge(origin, "hosted", basePath)
}

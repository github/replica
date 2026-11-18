import { installBridge } from ".."

export function installHostedBridge(origin: string) {
  installBridge(origin, "hosted")
}

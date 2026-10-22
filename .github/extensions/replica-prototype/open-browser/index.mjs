import { runCommand } from "../run-command/index.mjs"
export async function openBrowser(url, { platform = process.platform, run = runCommand } = {}) {
  const target = new URL(url)
  if (!["http:", "https:"].includes(target.protocol) || target.username || target.password) {
    throw new Error("Browser approval requires an HTTP or HTTPS URL without credentials.")
  }
  if (platform === "darwin") return run("open", [target.href])
  if (platform === "win32") return run("rundll32", ["url.dll,FileProtocolHandler", target.href])
  return run("xdg-open", [target.href])
}

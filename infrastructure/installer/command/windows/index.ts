import { existsSync } from "node:fs"
import { delimiter, join, resolve } from "node:path"

export function resolveWindowsCommand(
  executable: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): { executable: string; args: string[]; env: NodeJS.ProcessEnv } {
  if (executable !== "az") return { executable, args, env }
  const pathKey = Object.keys(env)
    .sort()
    .find((key) => key.toLowerCase() === "path")
  for (const directory of (pathKey ? (env[pathKey] ?? "") : "").split(delimiter)) {
    if (!directory) continue
    const native = join(directory, "az.exe")
    if (existsSync(native)) return { executable: native, args, env }
    if (existsSync(join(directory, "az.cmd"))) {
      const python = resolve(directory, "..", "python.exe")
      if (!existsSync(python))
        throw new Error(
          "The Windows Azure CLI launcher has no bundled Python executable. Install the official Windows Azure CLI or use a native az.exe; setup does not run batch files through a shell.",
        )
      return {
        executable: python,
        args: ["-IBm", "azure.cli", ...args],
        env: { ...env, AZ_INSTALLER: "MSI" },
      }
    }
  }
  return { executable, args, env }
}

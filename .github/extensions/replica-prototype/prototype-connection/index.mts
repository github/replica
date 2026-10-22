import { createHash, randomBytes } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import { readErrorCode } from "../read-error-code/index.mjs"

export type PrototypeConnection = ReturnType<typeof prototypeConnection>

export function prototypeConnection(sessionWorkspacePath: string, repositoryPath: string) {
  if (!sessionWorkspacePath || !repositoryPath) {
    throw new Error("Connecting a prototype requires a session workspace and working directory.")
  }
  const key = createHash("sha256").update(path.resolve(repositoryPath)).digest("hex").slice(0, 24)
  const directory = path.join(sessionWorkspacePath, "replica-prototype")
  const file = path.join(directory, `connection-${key}.json`)
  return {
    async read(): Promise<unknown> {
      try {
        return JSON.parse(await readFile(file, "utf8"))
      } catch (error) {
        if (readErrorCode(error) === "ENOENT") return null
        throw error
      }
    },
    async save(input: unknown) {
      await mkdir(directory, { recursive: true })
      const temporary = `${file}.${randomBytes(8).toString("hex")}.tmp`
      await writeFile(temporary, JSON.stringify(input), { mode: 0o600 })
      await rename(temporary, file)
    },
  }
}

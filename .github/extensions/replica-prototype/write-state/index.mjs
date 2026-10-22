import { randomUUID } from "node:crypto"
import { mkdir, rename, writeFile } from "node:fs/promises"
export async function writeState(context, state) {
  await mkdir(context.stateDirectory, { recursive: true })
  const temporaryFile = `${context.stateFile}.${process.pid}.${randomUUID()}.new`
  await writeFile(temporaryFile, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  })
  await rename(temporaryFile, context.stateFile)
}

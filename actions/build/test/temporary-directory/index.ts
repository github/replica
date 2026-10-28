import { mkdtemp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

export const temporaryDirectories: string[] = []

export async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "replica-build-action-"))
  temporaryDirectories.push(directory)
  return directory
}

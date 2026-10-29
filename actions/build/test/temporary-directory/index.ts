import { mkdtemp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

/** Creates a temporary directory for one action test. */
export async function temporaryDirectory() {
  return mkdtemp(path.join(os.tmpdir(), "replica-build-action-"))
}

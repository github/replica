import { rm } from "node:fs/promises"

import { afterEach } from "vitest"

import { temporaryDirectories } from "./temporary-directory/index.ts"

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

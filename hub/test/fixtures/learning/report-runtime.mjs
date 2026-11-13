import { stat } from "node:fs/promises"

const temporaryDirectory = process.env.TMPDIR
const status = await stat(temporaryDirectory)

process.stdout.write(
  JSON.stringify({
    arguments: process.argv.slice(2),
    environment: process.env,
    temporaryDirectory,
    temporaryDirectoryMode: status.mode & 0o777,
  }),
)

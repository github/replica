import path from "node:path"

/** Reads a named command-line path and returns its absolute path. */
export function requiredPathArgument(name: string) {
  const index = process.argv.indexOf(`--${name}`)
  const value = process.argv[index + 1]

  if (index === -1 || !value || value.startsWith("--")) {
    throw new Error(`Missing required --${name} path.`)
  }

  return path.resolve(value)
}

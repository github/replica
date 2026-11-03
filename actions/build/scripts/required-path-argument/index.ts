import path from "node:path"

/** Reads a named path, leaving it relative when the caller must check its workspace boundary. */
export function requiredPathArgument(name: string, { resolve = true } = {}) {
  const index = process.argv.indexOf(`--${name}`)
  const value = process.argv[index + 1]

  if (index === -1 || !value || value.startsWith("--")) {
    throw new Error(`Missing required --${name} path.`)
  }

  return resolve ? path.resolve(value) : value
}

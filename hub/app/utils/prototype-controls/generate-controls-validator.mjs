import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import Ajv from "ajv"
import standaloneCode from "ajv/dist/standalone/index.js"
import { build } from "vite"
import schema from "./controls.replica.schema.json" with { type: "json" }

/** Includes runtime helpers so retained-asset validation needs no npm install. */
async function bundleValidator(source) {
  const directory = await mkdtemp(join(tmpdir(), "replica-controls-validator-"))
  try {
    const entry = join(directory, "validator.cjs")
    await writeFile(entry, source)
    const require = createRequire(import.meta.url)
    const result = await build({
      configFile: false,
      publicDir: false,
      logLevel: "silent",
      resolve: { alias: { ajv: dirname(require.resolve("ajv/package.json")) } },
      build: {
        write: false,
        minify: true,
        lib: { entry, formats: ["cjs"] },
      },
    })
    const bundle = (Array.isArray(result) ? result[0] : result).output.find(
      (output) => output.type === "chunk",
    )
    if (!bundle) throw new Error("Controls validator bundling produced no JavaScript.")
    return bundle.code
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

const ajv = new Ajv({
  allErrors: true,
  strict: true,
  allowUnionTypes: true,
  code: { source: true },
})
ajv.addSchema(schema)
const branches = [
  "boolean",
  "number",
  "slider",
  "choice",
  "checkboxGroup",
  "text",
  "color",
  "button",
]
const validators = {
  validateShape: schema.$id,
  validateDeclaration: `${schema.$id}#/$defs/declaration`,
  validateDocumentShape: `${schema.$id}#/$defs/document`,
  ...Object.fromEntries(branches.map((branch) => [branch, `${schema.$id}#/$defs/${branch}`])),
}
const output =
  "// Generated from controls.replica.schema.json. Run npm run controls:schema:generate.\n" +
  "/* eslint-disable */\n" +
  (await bundleValidator(standaloneCode(ajv, validators)))
const destination = new URL("./controls-shape.cjs", import.meta.url)
if (process.argv.includes("--check")) {
  if ((await readFile(destination, "utf8")) !== output)
    throw new Error("Controls validator is stale. Run npm run controls:schema:generate.")
} else {
  await writeFile(destination, output)
}

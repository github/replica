import { fileURLToPath } from "node:url"
import { readCatalog } from "./starter-catalog.mjs"

const entries = readCatalog(fileURLToPath(new URL("../starters/catalog.tsv", import.meta.url)))
console.log(JSON.stringify(entries.map(({ id, directory }) => ({ id, directory }))))

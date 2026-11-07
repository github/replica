import { readFileSync, realpathSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

const DECISIONS = new Set(["build", "stub-external", "stub-auth", "stub-download", "deferred"])
const STATUSES = new Set(["planned", "built", "verified", "blocked"])
const FINAL_STATUSES = new Set(["verified", "blocked"])
const LOCAL_BOUNDARIES = new Set(["stub-auth", "stub-download", "deferred"])

export function checkLedger(ledger, { final = false } = {}) {
  const problems = []

  if (typeof ledger.source !== "string") problems.push("source: missing source URL")
  if (!ledger.browser || ledger.browser.cookies !== 0) {
    problems.push("browser: runtime isolation proof missing or cookies were present")
  }
  if (!ledger.access || Object.keys(ledger.access).length === 0) {
    problems.push("access: no access method recorded")
  }
  if (!Array.isArray(ledger.pages) || ledger.pages.length === 0) {
    problems.push("pages: no destinations recorded")
    return problems
  }

  const families = new Map()
  const routes = new Map()
  const urls = new Set()
  for (const [index, page] of ledger.pages.entries()) {
    const label = page.url ?? `pages[${index}]`
    if (urls.has(page.url)) problems.push(`${label}: listed more than once`)
    urls.add(page.url)
    if (!DECISIONS.has(page.decision))
      problems.push(`${label}: unknown decision "${page.decision}"`)
    if (!Array.isArray(page.foundIn) || page.foundIn.length === 0)
      problems.push(`${label}: foundIn is empty`)
    if (page.decision !== "build" && !LOCAL_BOUNDARIES.has(page.decision)) continue

    const kind = page.decision === "build" ? "build page" : "local boundary"
    if (
      typeof page.route !== "string" ||
      !page.route.startsWith("/") ||
      page.route.startsWith("//") ||
      page.route.includes("\\") ||
      /[\u0000-\u001f\u007f]/.test(page.route)
    )
      problems.push(`${label}: ${kind} has no local route`)
    if (!STATUSES.has(page.status)) problems.push(`${label}: unknown status "${page.status}"`)
    if (final && !FINAL_STATUSES.has(page.status))
      problems.push(`${label}: status "${page.status}" is not final`)
    if (page.status === "blocked" && !page.note) problems.push(`${label}: blocked without a note`)

    if (routes.has(page.route))
      problems.push(`${label}: route ${page.route} also used by ${routes.get(page.route)}`)
    routes.set(page.route, label)
    if (page.decision !== "build") continue

    if (typeof page.family !== "string") problems.push(`${label}: build page has no family`)
    const family = families.get(page.family) ?? { representatives: 0 }
    if (page.representative) family.representatives += 1
    families.set(page.family, family)
  }

  for (const [name, family] of families) {
    if (family.representatives !== 1) {
      problems.push(
        `family ${name}: needs exactly one representative, found ${family.representatives}`,
      )
    }
  }

  return problems
}

function summarize(ledger) {
  const counts = {}
  for (const page of ledger.pages ?? []) {
    const key = page.decision === "build" ? `build/${page.status}` : page.decision
    counts[key] = (counts[key] ?? 0) + 1
  }
  return counts
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const args = process.argv.slice(2)
  const final = args.includes("--final")
  const path = resolve(args.find((arg) => !arg.startsWith("--")) ?? "reference/coverage.json")

  let ledger
  try {
    ledger = JSON.parse(readFileSync(path, "utf8"))
  } catch (error) {
    console.error(`Cannot read ledger ${path}: ${error.message}`)
    process.exit(2)
  }

  const problems = checkLedger(ledger, { final })
  console.log(JSON.stringify(summarize(ledger)))
  if (problems.length > 0) {
    for (const problem of problems) console.error(problem)
    process.exitCode = 1
  }
}

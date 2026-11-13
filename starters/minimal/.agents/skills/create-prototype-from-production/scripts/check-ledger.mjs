import { readFileSync, realpathSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

import { checkPublicUrl, hasCredentials } from "./check-public-url.mjs"

const DECISIONS = new Set(["build", "stub-external", "stub-auth", "stub-download", "deferred"])
const STATUSES = new Set(["planned", "built", "verified", "blocked"])
const FINAL_STATUSES = new Set(["verified", "blocked"])
const LOCAL_BOUNDARIES = new Set(["stub-auth", "stub-download", "deferred"])
const HTTP_PROTOCOLS = new Set(["http:", "https:"])

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isNonblankString(value) {
  return typeof value === "string" && value.trim().length > 0
}

function absoluteUrl(value) {
  if (!isNonblankString(value) || !URL.canParse(value)) return undefined
  return new URL(value)
}

export function checkLedger(ledger, { final = false } = {}) {
  if (!isRecord(ledger)) return ["ledger: expected a JSON object"]
  const problems = []

  const source = absoluteUrl(ledger.source)
  const sourceProblem = checkPublicUrl(ledger.source)
  if (sourceProblem) problems.push(`source: ${sourceProblem}`)
  const credentialProblem = hasCredentials(ledger.source)
  if (credentialProblem) problems.push(`source: ${credentialProblem}`)
  if (!ledger.browser || ledger.browser.cookies !== 0 || ledger.browser.pages !== 1) {
    problems.push("browser: runtime isolation proof requires zero cookies and exactly one page")
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
  let sourcePage
  for (const [index, page] of ledger.pages.entries()) {
    if (!isRecord(page)) {
      problems.push(`pages[${index}]: expected a page object`)
      continue
    }
    const url = absoluteUrl(page.url)
    const label = `pages[${index}]`
    if (!url) {
      problems.push(`${label}: requires an absolute destination URL`)
    } else {
      if (HTTP_PROTOCOLS.has(url.protocol)) {
        const problem = checkPublicUrl(page.url)
        if (problem) problems.push(`${label}: ${problem}`)
      }
      if (urls.has(url.href)) problems.push(`${label}: listed more than once`)
      urls.add(url.href)
      if (url.href === source?.href) sourcePage = page
    }
    if (!DECISIONS.has(page.decision)) problems.push(`${label}: unknown decision`)
    if (!Array.isArray(page.foundIn) || page.foundIn.length === 0)
      problems.push(`${label}: foundIn is empty`)
    if (
      url &&
      page.decision === "build" &&
      (!HTTP_PROTOCOLS.has(url.protocol) || (source && url.origin !== source.origin))
    )
      problems.push(`${label}: build target must be an HTTP(S) URL on the source origin`)
    if (
      url &&
      page.decision === "stub-external" &&
      !["mailto:", "tel:"].includes(url.protocol) &&
      (!HTTP_PROTOCOLS.has(url.protocol) || url.origin === source?.origin)
    )
      problems.push(`${label}: external target must be off-origin HTTP(S), mailto: or tel:`)
    if (url && LOCAL_BOUNDARIES.has(page.decision) && !HTTP_PROTOCOLS.has(url.protocol))
      problems.push(
        `${label}: local boundary target must be HTTP(S); record non-web actions in page notes`,
      )
    if (page.decision !== "build" && !LOCAL_BOUNDARIES.has(page.decision)) continue

    const kind = page.decision === "build" ? "build page" : "local boundary"
    const hasLocalRoute =
      typeof page.route === "string" &&
      page.route.startsWith("/") &&
      !page.route.startsWith("//") &&
      !page.route.includes("\\") &&
      !/[\u0000-\u001f\u007f]/.test(page.route)
    if (!hasLocalRoute) problems.push(`${label}: ${kind} has no local route`)
    if (!STATUSES.has(page.status)) problems.push(`${label}: unknown status`)
    if (final && !FINAL_STATUSES.has(page.status)) problems.push(`${label}: status is not final`)
    if (page.status === "blocked" && !isNonblankString(page.note))
      problems.push(`${label}: blocked without a note; expected a nonblank string`)
    if (page.status === "verified" && !isNonblankString(page.note))
      problems.push(`${label}: verified without an evidence note; expected a nonblank string`)

    if (hasLocalRoute) {
      if (routes.has(page.route))
        problems.push(`${label}: local route also used by ${routes.get(page.route)}`)
      routes.set(page.route, label)
    }
    if (page.decision !== "build") continue

    if (typeof page.family !== "string") {
      problems.push(`${label}: build page has no family`)
      continue
    }
    const family = families.get(page.family) ?? { representatives: 0, label }
    if (page.representative) family.representatives += 1
    families.set(page.family, family)
  }

  if (source && !sourcePage) {
    problems.push("source: no row represents the source URL")
  } else if (sourcePage?.decision === "stub-external") {
    problems.push("source: requires a build page or local boundary, not an outbound-only stub")
  } else if (sourcePage?.decision === "deferred" && !isNonblankString(sourcePage.note)) {
    problems.push("source: deferred without a scope-exclusion reason")
  }

  for (const family of families.values()) {
    if (family.representatives !== 1) {
      problems.push(
        `${family.label}: family needs exactly one representative, found ${family.representatives}`,
      )
    }
  }

  return problems
}

function summarize(ledger) {
  const counts = {}
  for (const page of Array.isArray(ledger?.pages) ? ledger.pages : []) {
    if (!isRecord(page) || !DECISIONS.has(page.decision)) continue
    const local = page.decision === "build" || LOCAL_BOUNDARIES.has(page.decision)
    if (local && !STATUSES.has(page.status)) continue
    const key = local ? `${page.decision}/${page.status}` : page.decision
    counts[key] = (counts[key] ?? 0) + 1
  }
  return counts
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const args = process.argv.slice(2)
  const unknownOption = args.find((arg) => arg.startsWith("--") && arg !== "--final")
  if (unknownOption) {
    console.error(`Unknown option ${JSON.stringify(unknownOption)}; expected --final.`)
    process.exit(2)
  }
  const paths = args.filter((arg) => !arg.startsWith("--"))
  if (paths.length > 1) {
    console.error("Expected at most one ledger path.")
    process.exit(2)
  }
  const final = args.includes("--final")
  const path = resolve(paths[0] ?? "reference/coverage.json")

  let contents
  try {
    contents = readFileSync(path, "utf8")
  } catch (error) {
    console.error(`Cannot read ledger ${path}: ${error.message}`)
    process.exit(2)
  }
  let ledger
  try {
    ledger = JSON.parse(contents)
  } catch {
    console.error("Cannot parse ledger: expected valid JSON.")
    process.exit(2)
  }

  const problems = checkLedger(ledger, { final })
  console.log(JSON.stringify(summarize(ledger)))
  if (problems.length > 0) {
    for (const problem of problems) console.error(problem)
    process.exitCode = 1
  }
}

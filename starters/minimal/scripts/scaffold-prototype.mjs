import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const scriptPath = fileURLToPath(import.meta.url)
export const ROOT = resolve(dirname(scriptPath), "..")
const REQUIRED_VALUE_FLAGS = ["slug", "name", "description", "start-page", "scope", "template"]
const ROUTE_IMPORT_PATTERN =
  /import\s*\{\s*([A-Za-z_$][\w$]*Route)\s*\}\s*from\s*(["'])([^"'\r\n]+)\/([a-z0-9]+(?:-[a-z0-9]+)*)\/route\2;?/g

export function parseArgs(argv) {
  const args = {}

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith("--")) continue

    const key = token.slice(2)
    const next = argv[index + 1]
    if (next === undefined || next.startsWith("--")) {
      args[key] = true
    } else {
      args[key] = next
      index += 1
    }
  }

  return args
}

export function toIdentifierBase(slug) {
  const pascal = slug
    .split("-")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join("")

  return /^[A-Za-z_$]/.test(pascal) ? pascal : `Prototype${pascal}`
}

export function toIdentifierCamel(slug) {
  const base = toIdentifierBase(slug)
  return `${base.charAt(0).toLowerCase()}${base.slice(1)}`
}

export function toTitle(slug) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ")
}

export function isValidSlug(value) {
  return typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
}

export function isValidStartPage(value) {
  return (
    typeof value === "string" &&
    /^\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/.test(value)
  )
}

function assertStringFlags(args) {
  for (const flag of REQUIRED_VALUE_FLAGS) {
    if (flag in args && typeof args[flag] !== "string") {
      throw new Error(`--${flag} requires a value.`)
    }
  }
}

function readJsonIfExists(filePath) {
  if (!existsSync(filePath)) return {}
  return readJsonObject(filePath, `existing ${filePath}`)
}

function readJsonObject(filePath, label) {
  if (!existsSync(filePath)) throw new Error(`${label} is missing at ${filePath}.`)

  try {
    const value = JSON.parse(readFileSync(filePath, "utf8"))
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error("the root value must be a JSON object")
    }
    return value
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Cannot parse ${label}: ${detail}.`)
  }
}

function assertConfig(config) {
  if (
    !config ||
    typeof config !== "object" ||
    !config.registry ||
    typeof config.registry.path !== "string" ||
    typeof config.registry.importsEnd !== "string" ||
    (config.registry.importLine !== undefined &&
      typeof config.registry.importLine !== "function") ||
    !config.scopes ||
    typeof config.scopes !== "object" ||
    !config.templates ||
    typeof config.templates.createFiles !== "function" ||
    typeof config.resolveRoutePath !== "function"
  ) {
    throw new Error(
      "Invalid prototype scaffold configuration. Define registry markers, scopes, resolveRoutePath, and templates.createFiles.",
    )
  }
}

function routeEndFor(config, scope) {
  const marker = config.scopes[scope]?.registryEnd
  if (typeof marker !== "string") {
    throw new Error(
      `Scope "${scope}" is missing a registryEnd marker in the scaffold configuration.`,
    )
  }
  return marker
}

export function registerRoute(source, { config, camel, slug, scope }) {
  const routesEnd = routeEndFor(config, scope)
  const { importsEnd } = config.registry
  if (!source.includes(importsEnd) || !source.includes(routesEnd)) {
    throw new Error(`${config.registry.path} is missing the scaffold marker blocks.`)
  }

  const importLine =
    config.registry.importLine?.({ camel, slug }) ??
    `import {${camel}Route} from '../routes/${slug}/route';`
  if (typeof importLine !== "string" || !importLine) {
    throw new Error("Scaffold registry importLine must return a non-empty string.")
  }
  const generatedImport = [...importLine.matchAll(ROUTE_IMPORT_PATTERN)]
  if (
    generatedImport.length !== 1 ||
    generatedImport[0][0] !== importLine.trim() ||
    generatedImport[0][1] !== `${camel}Route` ||
    generatedImport[0][4] !== slug
  ) {
    throw new Error("Scaffold registry importLine must import the route from <path>/<slug>/route.")
  }
  const routeLine = `${camel}Route,`
  const existingImport = [...source.matchAll(ROUTE_IMPORT_PATTERN)].find(
    (match) => match[1] === `${camel}Route`,
  )
  if (existingImport && existingImport[4] !== slug) {
    throw new Error(
      `Route identifier "${camel}Route" already belongs to "${existingImport[4]}". Choose a different slug.`,
    )
  }

  let next = source
  if (!existingImport) next = next.replace(importsEnd, `${importLine}\n${importsEnd}`)
  if (!new RegExp(`\\n\\s*${camel}Route,`).test(next)) {
    next = next.replace(routesEnd, `${routeLine}\n  ${routesEnd}`)
  }
  return next
}

export function readRoutePath(source) {
  return source.match(/^\s*path:\s*(["'])([^"']*)\1,?\s*$/m)?.[2]
}

export function readRouteStartPage(source) {
  const uncommented = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
  const metadata = uncommented.match(
    /^\s*export const [A-Za-z0-9_$]+StartPage = (["'])([^"']*)\1;?\s*$/m,
  )
  return metadata ? metadata[2] : readRoutePath(uncommented)
}

function getRegisteredRoutes(root, registrySource) {
  const routes = []
  for (const match of registrySource.matchAll(ROUTE_IMPORT_PATTERN)) {
    const slug = match[4]
    const routePath = join(root, "src", "routes", slug, "route.tsx")
    if (!existsSync(routePath)) {
      throw new Error(
        `Registered route "${slug}" is missing ${routePath}. Fix the registry before scaffolding.`,
      )
    }
    const startPage = readRouteStartPage(readFileSync(routePath, "utf8"))
    if (!startPage) {
      throw new Error(
        `Cannot read the path from registered route "${slug}". Keep the generated path as a JSON string.`,
      )
    }
    routes.push({ slug, startPage })
  }
  return routes
}

function assertStartPageAvailable({ config, root, registrySource, slug, startPage, scope }) {
  if (config.reservedStartPages?.includes(startPage)) {
    throw new Error(
      `Start page "${startPage}" is reserved by the starter. Choose a different path.`,
    )
  }
  config.validateStartPageAvailability?.({ startPage, scope })
  config.validateRouteAvailability?.({
    slug,
    camel: toIdentifierCamel(slug),
    startPage,
    scope,
    registrySource,
  })

  const conflict = getRegisteredRoutes(root, registrySource).find(
    (route) => route.slug !== slug && route.startPage === startPage,
  )
  if (conflict) {
    throw new Error(
      `Start page "${startPage}" is already registered by "${conflict.slug}". Choose a different path.`,
    )
  }
}

function prototypePath(root, config) {
  return join(root, config.prototypePath ?? ".prototype")
}

export function buildScaffoldFiles({
  config,
  slug,
  name,
  description,
  startPage,
  scope,
  routePath,
}) {
  const scopeConfig = config.scopes[scope]
  return config.templates.createFiles({
    slug,
    name,
    description,
    startPage,
    scope,
    scopeConfig,
    routePath,
    pascal: toIdentifierBase(slug),
    camel: toIdentifierCamel(slug),
  })
}

export function installTemplate({ root = ROOT, config, args = {} } = {}) {
  assertConfig(config)
  assertStringFlags(args)
  const templateId = typeof args.template === "string" ? args.template.trim() : ""
  if (!templateId) throw new Error("--template requires a canonical template id.")
  if (args.slug || args.scope || args["start-page"]) {
    throw new Error("--template cannot be combined with --slug, --scope, or --start-page.")
  }

  const catalog = readJsonObject(
    join(root, config.templateCatalogPath ?? "prototype-templates.json"),
    "template catalog",
  )
  if (
    catalog.schemaVersion !== 1 ||
    !Array.isArray(catalog.templates) ||
    typeof catalog.families !== "object" ||
    catalog.families === null
  ) {
    throw new Error("Template catalog must define schemaVersion 1, families, and templates.")
  }

  const template = catalog.templates.find(
    (candidate) =>
      typeof candidate === "object" && candidate !== null && candidate.id === templateId,
  )
  if (!template) {
    const ids = catalog.templates
      .map((candidate) => candidate?.id)
      .filter((id) => typeof id === "string")
    throw new Error(`Unknown --template "${templateId}". Use one of: ${ids.join(", ")}.`)
  }
  if (
    typeof template.family !== "string" ||
    typeof template.name !== "string" ||
    typeof template.description !== "string" ||
    typeof template.startPage !== "string"
  ) {
    throw new Error(`Template "${templateId}" is missing required metadata.`)
  }
  const family = catalog.families[template.family]
  if (!family || typeof family !== "object" || !Array.isArray(family.requiredFiles)) {
    throw new Error(`Template family "${template.family}" is not configured.`)
  }
  const missingFiles = family.requiredFiles.filter(
    (filePath) => typeof filePath !== "string" || !existsSync(join(root, filePath)),
  )
  if (missingFiles.length > 0) {
    throw new Error(
      `Template family "${template.family}" is incomplete. Missing: ${missingFiles.join(", ")}`,
    )
  }

  const target = prototypePath(root, config)
  readJsonIfExists(target)
  const prototype = {
    startPage:
      config.resolvePrototypeStartPage?.({ startPage: template.startPage }) ?? template.startPage,
  }
  writeFileSync(target, `${JSON.stringify(prototype, null, 2)}\n`)
  return {
    created: false,
    template: template.id,
    family: template.family,
    startPage: template.startPage,
    files: family.requiredFiles,
  }
}

export function scaffold({ root = ROOT, config, args = {} } = {}) {
  assertConfig(config)
  assertStringFlags(args)
  if ("template" in args) return installTemplate({ root, config, args })

  const slug = typeof args.slug === "string" ? args.slug.trim() : ""
  if (!isValidSlug(slug)) {
    throw new Error(
      "A valid --slug is required. Use lowercase letters, numbers, and single hyphens.",
    )
  }
  const name = typeof args.name === "string" ? args.name.trim() : toTitle(slug)
  const description = typeof args.description === "string" ? args.description.trim() : undefined
  const scope = typeof args.scope === "string" ? args.scope.trim() : (config.defaultScope ?? "app")
  const scopeConfig = config.scopes[scope]
  if (!scopeConfig) {
    throw new Error(
      `Invalid --scope "${scope}". Use one of: ${Object.keys(config.scopes).join(", ")}.`,
    )
  }
  if (scopeConfig.requiresStartPage && typeof args["start-page"] !== "string") {
    throw new Error(`--start-page is required for --scope ${scope}.`)
  }
  const startPage = typeof args["start-page"] === "string" ? args["start-page"].trim() : `/${slug}`
  if (!name) throw new Error("--name must not be empty.")
  if (!isValidStartPage(startPage)) {
    throw new Error(
      `Invalid --start-page ${JSON.stringify(startPage)}. Use a static lowercase path such as "/repository-activity".`,
    )
  }

  const routePath = config.resolveRoutePath({ scope, startPage })
  const registryPath = join(root, config.registry.path)
  const registrySource = readFileSync(registryPath, "utf8")
  const camel = toIdentifierCamel(slug)
  const updatedRegistry = registerRoute(registrySource, { config, camel, slug, scope })
  assertStartPageAvailable({ config, root, registrySource, slug, startPage, scope })
  const targetPrototypePath = prototypePath(root, config)
  readJsonIfExists(targetPrototypePath)
  const files = buildScaffoldFiles({
    config,
    slug,
    name,
    description,
    startPage,
    scope,
    routePath,
  })
  const existingTargets = Object.keys(files).filter((filePath) => existsSync(join(root, filePath)))
  if (existingTargets.length > 0 && existingTargets.length !== Object.keys(files).length) {
    throw new Error(
      `Partial scaffold exists for "${slug}". Refusing to overwrite files. Resolve or remove these paths first: ${existingTargets.join(", ")}`,
    )
  }

  const created = existingTargets.length === 0
  if (!created) {
    const routeSource = readFileSync(join(root, "src", "routes", slug, "route.tsx"), "utf8")
    if (readRouteStartPage(routeSource) !== startPage || readRoutePath(routeSource) !== routePath) {
      throw new Error(
        `Existing route "${slug}" does not match start page "${startPage}". Refusing to update .prototype without changing the route.`,
      )
    }
  }
  if (created) {
    for (const [filePath, contents] of Object.entries(files)) {
      const target = join(root, filePath)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, contents)
    }
  }
  if (updatedRegistry !== registrySource) writeFileSync(registryPath, updatedRegistry)
  const prototype = { startPage: config.resolvePrototypeStartPage?.({ startPage }) ?? startPage }
  writeFileSync(targetPrototypePath, `${JSON.stringify(prototype, null, 2)}\n`)
  return { created, slug, scope, startPage, files: Object.keys(files) }
}

async function loadConfig(root) {
  const configPath = join(root, "prototype-scaffold.config.mjs")
  if (!existsSync(configPath)) {
    throw new Error(`Prototype scaffold configuration is missing at ${relative(root, configPath)}.`)
  }
  const module = await import(pathToFileURL(configPath).href)
  return module.default
}

function printHelp() {
  process.stdout.write(`Usage:
  npm run scaffold -- --slug <route-slug> [options]
  npm run scaffold -- --template <template-id> [options]

Options:
  --name <name>               Prototype and page title
  --description <text>        Seeded page description
  --start-page </path>        Route path, defaults to /<route-slug>
  --scope <scope>             A scope supplied by prototype-scaffold.config.mjs
`)
}

if (resolve(process.argv[1] ?? "") === scriptPath) {
  try {
    const args = parseArgs(process.argv.slice(2))
    if (args.help) {
      printHelp()
    } else {
      const result = scaffold({ args, config: await loadConfig(ROOT) })
      const message =
        "template" in result
          ? `Selected seed-backed template "${result.template}" at ${result.startPage}.\n`
          : `${result.created ? "Created" : "Updated metadata for"} seed-backed route "${result.slug}" at ${result.startPage}.\n`
      process.stdout.write(message)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`[scaffold] ${message}\n`)
    process.exitCode = 1
  }
}

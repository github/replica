import { BuildPackageError } from "../errors.ts"

const maximumTemplates = 12
const uriPath = /^(?:[a-z0-9._~!$&'()*+,;=:@/-]|%[0-9a-f]{2})*$/i
const uriFragment = /^(?:[a-z0-9._~!$&'()*+,;=:@/?-]|%[0-9a-f]{2})*$/i
const templateKeys = "category,description,id,name,path"

function isWellFormed(value: string) {
  return Buffer.from(value, "utf8").toString("utf8") === value
}

function containsControls(text: string) {
  return [...text].some((character) => {
    const code = character.charCodeAt(0)
    return code < 32 || code === 127
  })
}

function validatePath(id: string, path: unknown) {
  if (
    typeof path !== "string" ||
    !isWellFormed(path) ||
    Buffer.byteLength(path) > 2_048 ||
    !path.startsWith("/") ||
    path.startsWith("//") ||
    /[\s\\]|\p{Cc}/u.test(path)
  ) {
    throw new BuildPackageError(`Template ${id} path must be a local browser route.`)
  }
  let pathname: string
  try {
    pathname = decodeURIComponent(path.split(/[?#]/, 1)[0] ?? "")
  } catch {
    throw new BuildPackageError(`Template ${id} path contains invalid percent encoding.`)
  }
  if (
    pathname.startsWith("//") ||
    /[\s\\%]|\p{Cc}/u.test(pathname) ||
    pathname.split("/").some((segment) => [".", "..", ".replica-internal"].includes(segment)) ||
    pathname === "/__replica" ||
    pathname.startsWith("/__replica/")
  ) {
    throw new BuildPackageError(`Template ${id} path contains an unsupported route.`)
  }
  const url = new URL(path, "http://preview.invalid")
  if (
    Buffer.byteLength(`${url.pathname}${url.search}${url.hash}`) > 2_048 ||
    !uriPath.test(url.pathname) ||
    !uriFragment.test(url.hash.slice(1))
  ) {
    throw new BuildPackageError(`Template ${id} path must be a start-page compatible route.`)
  }
}

/**
 * Validates a Build package's templates.json document. Mirrors the build action's
 * validate-templates rules so Hub never trusts the workflow's validation alone.
 */
export function validateBuildTemplates(value: unknown): void {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== "templates,version" ||
    (value as { version?: unknown }).version !== 1
  ) {
    throw new BuildPackageError("templates.json must be a version 1 templates document.")
  }
  const templates: unknown = (value as { templates: unknown }).templates
  if (!Array.isArray(templates) || templates.length > maximumTemplates) {
    throw new BuildPackageError(
      `templates.json must contain an array of at most ${maximumTemplates} templates.`,
    )
  }
  const ids = new Set<string>()
  for (const template of templates as unknown[]) {
    if (
      !template ||
      typeof template !== "object" ||
      Array.isArray(template) ||
      Object.keys(template).sort().join(",") !== templateKeys
    ) {
      throw new BuildPackageError(
        "Each template must contain only id, name, category, description and path.",
      )
    }
    const { id, name, category, description, path } = template as Record<string, unknown>
    if (
      typeof id !== "string" ||
      id.length > 64 ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) ||
      id === "default" ||
      ids.has(id)
    ) {
      throw new BuildPackageError("Template IDs must be unique lowercase slugs other than default.")
    }
    ids.add(id)
    for (const [field, text, maximum] of [
      ["name", name, 120],
      ["category", category, 80],
      ["description", description, 500],
    ] as const) {
      if (
        typeof text !== "string" ||
        !isWellFormed(text) ||
        !text.trim() ||
        [...text].length > maximum ||
        containsControls(text)
      ) {
        throw new BuildPackageError(
          `Template ${id} ${field} must contain 1 to ${maximum} characters of well-formed Unicode.`,
        )
      }
    }
    validatePath(id, path)
  }
}

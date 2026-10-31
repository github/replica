import { MAX_TEMPLATES } from "../constants.ts"

const URI_PATH = /^(?:[a-z0-9._~!$&'()*+,;=:@/-]|%[0-9a-f]{2})*$/i
const URI_FRAGMENT = /^(?:[a-z0-9._~!$&'()*+,;=:@/?-]|%[0-9a-f]{2})*$/i

/** Returns template definitions with safe IDs and local preview destinations. */
export function validateTemplates(value: unknown) {
  function containsControls(text: string) {
    return [...text].some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  }

  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !("version" in value) ||
    value.version !== 1 ||
    Object.keys(value).some((key) => !["version", "hub", "templates"].includes(key))
  ) {
    throw new Error("Replica configuration must be a version 1 JSON object.")
  }

  if (!Object.hasOwn(value, "templates")) return null

  if (
    !("templates" in value) ||
    !Array.isArray(value.templates) ||
    value.templates.length > MAX_TEMPLATES
  ) {
    throw new Error(`Replica templates must be an array of at most ${MAX_TEMPLATES} entries.`)
  }

  const ids = new Set()
  const templates = value.templates.map((template: unknown) => {
    if (
      !template ||
      typeof template !== "object" ||
      Array.isArray(template) ||
      !("id" in template) ||
      !("name" in template) ||
      !("category" in template) ||
      !("description" in template) ||
      !("path" in template) ||
      Object.keys(template).sort().join(",") !== "category,description,id,name,path"
    ) {
      throw new Error(
        "Each Replica template must contain id, name, category, description and path.",
      )
    }

    const { id, name, category, description, path } = template
    if (
      typeof id !== "string" ||
      id.length > 64 ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) ||
      id === "default" ||
      ids.has(id)
    ) {
      throw new Error("Replica template IDs must be unique lowercase slugs other than default.")
    }
    ids.add(id)

    function requireText(field: string, text: unknown, maximum: number): asserts text is string {
      if (
        typeof text !== "string" ||
        !text.isWellFormed() ||
        !text.trim() ||
        [...text].length > maximum ||
        containsControls(text)
      ) {
        throw new Error(
          `Replica template ${id} ${field} must contain 1 to ${maximum} characters of well-formed Unicode.`,
        )
      }
    }

    requireText("name", name, 120)
    requireText("category", category, 80)
    requireText("description", description, 500)

    if (
      typeof path !== "string" ||
      !path.isWellFormed() ||
      Buffer.byteLength(path, "utf8") > 2048 ||
      !path.startsWith("/") ||
      path.startsWith("//") ||
      /[\s\\]|\p{Cc}/u.test(path)
    ) {
      throw new Error(`Replica template ${id} path must be a local browser route.`)
    }

    let pathname
    try {
      pathname = decodeURIComponent(path.split(/[?#]/, 1)[0])
    } catch (error) {
      throw new Error(`Replica template ${id} path contains invalid percent encoding.`, {
        cause: error,
      })
    }
    if (
      pathname.startsWith("//") ||
      /[\s\\%]|\p{Cc}/u.test(pathname) ||
      pathname.split("/").some((segment) => [".", "..", ".replica-internal"].includes(segment)) ||
      pathname === "/__replica" ||
      pathname.startsWith("/__replica/")
    ) {
      throw new Error(`Replica template ${id} path contains an unsupported route.`)
    }

    const url = new URL(path, "http://preview.invalid")
    const serialized = `${url.pathname}${url.search}${url.hash}`
    if (
      Buffer.byteLength(serialized, "utf8") > 2048 ||
      !URI_PATH.test(url.pathname) ||
      !URI_FRAGMENT.test(url.hash.slice(1))
    ) {
      throw new Error(
        `Replica template ${id} path must be a start-page compatible browser route of at most 2048 serialized bytes.`,
      )
    }

    return { id, name, category, description, path }
  })

  return { version: 1, templates }
}

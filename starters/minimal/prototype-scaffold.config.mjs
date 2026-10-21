import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const TEMPLATE_DIRECTORY = join(
  dirname(fileURLToPath(import.meta.url)),
  "scaffold-templates",
  "neutral",
)
const DEFAULT_DESCRIPTION = "Replace this description with the prototype scenario."

function renderTemplate(fileName, values) {
  return readFileSync(join(TEMPLATE_DIRECTORY, fileName), "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/__SCAFFOLD_[A-Z_]+__/g, (placeholder) => values[placeholder])
}

function createFiles({ slug, name, description, startPage, routePath, pascal, camel }) {
  const values = {
    __SCAFFOLD_SLUG__: slug,
    __SCAFFOLD_PASCAL__: pascal,
    __SCAFFOLD_CAMEL__: camel,
    __SCAFFOLD_JSON_TITLE__: JSON.stringify(name),
    __SCAFFOLD_JSON_DESCRIPTION__: JSON.stringify(description ?? DEFAULT_DESCRIPTION),
    __SCAFFOLD_ROUTE_PATH__: JSON.stringify(routePath),
    __SCAFFOLD_START_PAGE__: JSON.stringify(startPage),
  }

  return {
    [`src/data/seeds/${slug}.json`]: renderTemplate("seed.json", values),
    [`src/routes/${slug}/loader.ts`]: renderTemplate("loader.ts", values),
    [`src/routes/${slug}/${slug}-page/index.tsx`]: renderTemplate("Page.tsx", values),
    [`src/routes/${slug}/${slug}-page/types.ts`]: renderTemplate("types.ts", values),
    [`src/routes/${slug}/${slug}-page/styles.module.css`]: renderTemplate(
      "Page.module.css",
      values,
    ),
    [`src/routes/${slug}/route.tsx`]: renderTemplate("route.tsx", values),
    [`src/routes/${slug}/${slug}-route-page/index.tsx`]: renderTemplate("RoutePage.tsx", values),
  }
}

export default {
  registry: {
    path: "src/app/router.tsx",
    importsEnd: "// --- end scaffold:imports ---",
    importLine: ({ camel, slug }) => `import { ${camel}Route } from "@routes/${slug}/route"`,
  },
  reservedStartPages: ["/", "/about"],
  scopes: {
    app: {
      registryEnd: "// --- end scaffold:app-routes ---",
    },
  },
  resolveRoutePath({ startPage }) {
    return startPage.slice(1)
  },
  resolvePrototypeStartPage({ startPage }) {
    return `/#${startPage}`
  },
  validateRouteAvailability({ slug, camel }) {
    const existingRoutes = [
      { slug: "home", camel: "home" },
      { slug: "about", camel: "about" },
    ]
    const conflict = existingRoutes.find((route) => route.slug === slug || route.camel === camel)
    if (conflict) {
      throw new Error(
        `Route "${slug}" conflicts with the starter's existing "${conflict.slug}" route.`,
      )
    }
  },
  templates: { createFiles },
}

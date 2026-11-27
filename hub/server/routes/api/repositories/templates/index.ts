import type { Request, RequestHandler } from "express"
import { z } from "zod"

import { hashAuthenticationValue } from "../../../../domains/authentication/hash-authentication-value/index.ts"
import { createBuildPreviewOrigin } from "../../../../domains/build-preview/create-build-preview-origin/index.ts"
import { createPreviewGrant } from "../../../../domains/build-preview/create-preview-grant/index.ts"
import {
  readTemplateManifest,
  TemplateManifestUnavailable,
  templateIdSchema,
  templateReturnPath,
} from "../../../../domains/build-preview/read-template-manifest/index.ts"
import { templateScreenshotPath } from "../../../../domains/build-preview/template-screenshot-path/index.ts"
import { readHubSessionCookie } from "../../../../integrations/express/read-hub-session-cookie/index.ts"
import { GitHubProviderRequestError } from "../../../../integrations/github/errors.ts"
import type { BuildPreviewRouteDependencies } from "../../../build-preview/types.ts"
import type { CurrentSessionDependencies } from "../../auth/types.ts"
import { readProductSession } from "../../product/read-product-session/index.ts"
import { readProductWithCurrentAuthority } from "../../product/read-product-with-current-authority/index.ts"
import { canBrowseTemplates } from "../../product/template-repository-access/index.ts"
import { canStartPrototypeSession } from "../../product/can-start-prototype-session/index.ts"
import type { ProductViewer, WorkspaceProductRouteDependencies } from "../../product/types.ts"

const defaultTemplate = {
  id: "default",
  name: "Default",
  category: "Starter",
  description: "Start at the repository’s home page.",
  path: "/",
}

type TemplateDependencies = NonNullable<WorkspaceProductRouteDependencies["templates"]>
type Snapshot = NonNullable<Awaited<ReturnType<TemplateDependencies["findBuild"]>>>
type Build = NonNullable<Snapshot["build"]>
const accessQuery = z.discriminatedUnion("target", [
  z.strictObject({
    target: z.literal("preview"),
    route: z.string().max(2048),
    route_kind: z.literal("logical").optional(),
    preview_origin: z.url(),
  }),
  z.strictObject({
    target: z.literal("desktop"),
    template: templateIdSchema,
    theme: z.enum(["light", "dark"]),
  }),
])

function accessUrl(
  preview: BuildPreviewRouteDependencies,
  repositoryId: string,
  buildId: string,
  query: Record<string, string>,
) {
  const url = new URL(
    `/api/repositories/${repositoryId}/template-builds/${buildId}/access`,
    preview.applicationOrigin,
  )
  url.search = new URLSearchParams(query).toString()
  return url.toString()
}

function presentTemplate(
  entry: typeof defaultTemplate,
  repositoryId: string,
  build: Build | null,
  preview: BuildPreviewRouteDependencies | undefined,
  initialRoute: string,
  logicalRoute = false,
) {
  const previewable = preview && build?.artifacts.some(({ path }) => path === "dist/index.html")
  function screenshot(theme: "light" | "dark") {
    return previewable &&
      build?.artifacts.some(({ path }) => path === templateScreenshotPath(entry.id, theme))
      ? accessUrl(preview, repositoryId, build.id, { target: "desktop", template: entry.id, theme })
      : null
  }
  return {
    id: entry.id,
    name: entry.name,
    category: entry.category,
    description: entry.description,
    route: entry.path,
    buildNumber: build?.number ?? null,
    previewUrl:
      previewable && build
        ? accessUrl(preview, repositoryId, build.id, {
            target: "preview",
            route: initialRoute,
            ...(logicalRoute ? { route_kind: "logical" } : {}),
            preview_origin: createBuildPreviewOrigin(build.id, preview.previewBaseOrigin),
          })
        : null,
    screenshotUrl: screenshot("light"),
    darkScreenshotUrl: screenshot("dark"),
  }
}

export function templateRoutes(
  session: CurrentSessionDependencies,
  product: WorkspaceProductRouteDependencies & { templates: TemplateDependencies },
  preview: BuildPreviewRouteDependencies | undefined,
) {
  function authorized<Result>(
    read: (
      request: Request,
      viewer: ProductViewer & { userId: string },
      repositoryId: string,
    ) => Promise<Result | null>,
    send: (response: Parameters<RequestHandler>[1], result: Result, cookie: string) => void,
  ): RequestHandler {
    return async (request, response, next) => {
      try {
        const cookie = readHubSessionCookie(request)
        const initial = await readProductSession(cookie, session)
        if (!cookie || !initial) {
          response.status(401).json({ error: "Sign in to continue." })
          return
        }
        const repositoryId = z.uuid().safeParse(request.params.repositoryId)
        const snapshot = repositoryId.success
          ? await readProductWithCurrentAuthority(initial, cookie, session, (viewer) =>
              read(request, viewer, repositoryId.data),
            )
          : { result: null }
        if (!snapshot) response.status(401).json({ error: "Sign in to continue." })
        else if (snapshot.result === null)
          response.status(404).json({ error: "Template or repository not found." })
        else send(response, snapshot.result, cookie)
      } catch (error) {
        if (error instanceof TemplateManifestUnavailable) {
          response.status(503).json({ error: error.message })
          return
        }
        if (error instanceof GitHubProviderRequestError) {
          response.status(503).json({ error: "Hub could not check GitHub repository permissions." })
          return
        }
        next(error)
      }
    }
  }

  async function load(viewer: ProductViewer, repositoryId: string, buildId?: string) {
    const snapshot = await product.templates.findBuild(viewer, repositoryId, buildId)
    if (!snapshot || !canBrowseTemplates(viewer, Boolean(snapshot.repository.localPath)))
      return null
    const {
      build,
      repository: { localPath, ...repository },
    } = snapshot
    const manifest = build?.artifacts.find(({ path }) => path === "templates.json")
    const templates = [defaultTemplate, ...(await readTemplateManifest(manifest, preview?.storage))]
    return { repository, build, templates, local: Boolean(localPath) }
  }

  function read(detail: boolean) {
    return authorized(
      async (request, viewer, repositoryId) => {
        const id = detail ? templateIdSchema.safeParse(request.params.templateId) : null
        if (id && !id.success) return null
        const requestedPath = request.query.return_path
        const initialRoute =
          detail && typeof requestedPath === "string" ? templateReturnPath(requestedPath) : null
        if (detail && requestedPath !== undefined && !initialRoute) return null
        const snapshot = await load(viewer, repositoryId)
        if (!snapshot) return null
        const { repository, templates, build, local } = snapshot
        const canCreate = await canStartPrototypeSession(product, viewer, repositoryId)
        if (!canCreate) return null
        const submissionMode = local ? "copy" : "copilot"
        const context = { repository, canCreate, submissionMode }
        if (!id) {
          return {
            ...context,
            templates: templates.map((entry) =>
              presentTemplate(entry, repositoryId, build, preview, entry.path),
            ),
          }
        }
        const entry = templates.find(({ id: templateId }) => templateId === id.data)
        if (!entry) return null
        const route = initialRoute ?? entry.path
        const template = presentTemplate(
          entry,
          repositoryId,
          build,
          preview,
          route,
          initialRoute !== null && request.query.return_path_kind === "logical",
        )
        return {
          ...context,
          template,
          initialRoute: route,
          ...(template.previewUrl && build
            ? {
                controlsIdentity: `template:${hashAuthenticationValue(
                  JSON.stringify([viewer.userId, build.prototypeId, entry.id]),
                )}`,
              }
            : {}),
        }
      },
      (response, result) => {
        response.json(result)
      },
    )
  }

  return {
    catalog: read(false),
    detail: read(true),
    permission: authorized(
      async (_request, viewer, repositoryId) => {
        if (!(await canStartPrototypeSession(product, viewer, repositoryId))) return null
        return { canCreate: true }
      },
      (response, result) => {
        response.json(result)
      },
    ),
    access: authorized(
      async (request, viewer, repositoryId) => {
        const buildId = z.uuid().safeParse(request.params.buildId)
        const query = accessQuery.safeParse(request.query)
        if (!preview || !buildId.success || !query.success) return null
        const snapshot = await load(viewer, repositoryId, buildId.data)
        if (!snapshot?.build?.artifacts.some(({ path }) => path === "dist/index.html")) return null
        const origin = createBuildPreviewOrigin(buildId.data, preview.previewBaseOrigin)
        if (!(await product.isRepositoryVisible(viewer, repositoryId))) return null
        if (query.data.target === "preview") {
          const route = templateReturnPath(query.data.route)
          return route && query.data.preview_origin === origin
            ? { buildId: buildId.data, origin, route, routeKind: query.data.route_kind }
            : null
        }
        const { template, theme } = query.data
        if (!snapshot.templates.some(({ id }) => id === template)) return null
        const screenshotPath = templateScreenshotPath(template, theme)
        return snapshot.build.artifacts.some(({ path }) => path === screenshotPath)
          ? { buildId: buildId.data, origin, screenshotPath }
          : null
      },
      (response, result, cookie) => {
        if (!preview) return
        const destination = new URL("/__replica/authorize", result.origin)
        destination.searchParams.set(
          "grant",
          createPreviewGrant(
            {
              buildId: result.buildId,
              target: "template",
              screenshotPath: result.screenshotPath,
              expiresAt: new Date(Date.now() + 30_000),
              sessionDigest: hashAuthenticationValue(cookie),
            },
            preview.encryptionKey,
          ),
        )
        if (result.route) destination.searchParams.set("route", result.route)
        if (result.routeKind) destination.searchParams.set("route_kind", result.routeKind)
        response.setHeader("Referrer-Policy", "no-referrer")
        response.redirect(302, destination.toString())
      },
    ),
  }
}

import { http } from "@/test/stub-hub-fetch"

import type { previewRecords } from "../preview-records"

export function previewHandlers(data: ReturnType<typeof previewRecords>) {
  const { path, repository, prototype, controlsIdentity, canBranch } = data
  let showIntroduction = data.showPrototypeInfo
  return [
    http.get(`/api${path}`, ({ request }) => {
      const { searchParams } = new URL(request.url)
      const requestedBuild = searchParams.get("build")
      const selectedBuild =
        requestedBuild === null
          ? data.selectedBuild
          : prototype.builds.find(({ number }) => String(number) === requestedBuild)
      if (selectedBuild === undefined) {
        return Response.json({ error: "Build not found." }, { status: 404 })
      }
      const showPrototypeInfo = showIntroduction && searchParams.get("view") !== "minimized"
      if (showPrototypeInfo) showIntroduction = false
      return Response.json({
        repository,
        prototype,
        selectedBuild,
        showPrototypeInfo,
        controlsIdentity,
        canBranch,
      })
    }),
    http.get(`/api${path}/builds`, () =>
      Response.json({
        repository,
        prototype,
        builds: prototype.builds,
        pagination: { page: 1, pageSize: 25, pageCount: 1, totalCount: prototype.builds.length },
      }),
    ),
    ...(repository.capabilities?.reviewPrototypes
      ? []
      : [
          http.get(`/api${path}/review-comments`, () =>
            Response.json({ error: "Review access is not available." }, { status: 404 }),
          ),
        ]),
  ]
}

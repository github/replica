import { z } from "zod"

export function readWorkspaceRepositoryId({
  pathname,
  searchParams,
}: Pick<URL, "pathname" | "searchParams">) {
  const parsed = z
    .uuid()
    .safeParse(pathname.match(/^\/repositories\/([^/]+)/i)?.[1] ?? searchParams.get("repositoryId"))
  return parsed.success ? parsed.data.toLowerCase() : null
}

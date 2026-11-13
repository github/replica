import { useEffect, useState } from "react"
import { z } from "zod"

import { NoRepositoryAccessPage } from "@pages/no-repository-access-page"

export function meta() {
  return [{ title: "No repository access - Replica Hub" }]
}

const denialSchema = z.object({
  login: z
    .string()
    .regex(/^[a-z0-9-]{1,39}$/i)
    .nullable(),
  reason: z.literal("no_repository_access"),
})

export default function NoRepositoryAccess() {
  const [login, setLogin] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    void fetch("/api/auth/session?explain_no_repository_access=1", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status !== 401) return
        const denial = denialSchema.safeParse(await response.json())
        if (!controller.signal.aborted && denial.success) setLogin(denial.data.login)
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          console.error("Could not verify the GitHub account for repository access recovery.")
        }
      })
    return () => controller.abort()
  }, [])

  return <NoRepositoryAccessPage login={login} />
}

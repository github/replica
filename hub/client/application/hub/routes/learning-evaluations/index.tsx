import { useFetcher, useLocation } from "react-router"

import { canvasActionError } from "@application/hub/canvas-connections/contract"
import { recordIdentifierSchema } from "@application/hub/contracts"
import { FormBoundary } from "@application/hub/form-boundary"
import {
  evaluationSettingsResponseSchema,
  learningMutationResponseSchema,
} from "@application/hub/learnings-contracts"
import { requestJson } from "@application/hub/requests/request-json"
import { EvaluationSettingsPage } from "@pages/evaluation-settings-page"

import type { Route } from "./+types/index"
import type { WorkspaceRouteHandle } from "../workspace/types"

export const handle = { workspaceSection: "learnings" } satisfies WorkspaceRouteHandle

function repositoryId(value: string | undefined) {
  const parsed = recordIdentifierSchema.safeParse(value)
  if (!parsed.success) throw new Response("Invalid repository identifier.", { status: 400 })
  return parsed.data
}

export async function clientLoader({ request, params }: Route.ClientLoaderArgs) {
  const id = repositoryId(params.repositoryId)
  return requestJson(
    new URL(`/api/repositories/${id}/learnings/evaluations`, request.url),
    evaluationSettingsResponseSchema,
    { signal: request.signal },
  )
}

/** Reads an optional on/off field the switches send as text. */
function readSwitch(form: FormData, name: string) {
  const value = form.get(name)
  if (value === null) return undefined
  if (value !== "true" && value !== "false") {
    throw new Response(`A valid ${name} value is required.`, { status: 422 })
  }
  return value === "true"
}

export async function clientAction({ request, params }: Route.ClientActionArgs) {
  const id = repositoryId(params.repositoryId)
  if (request.method !== "POST") throw new Response("Method not allowed.", { status: 405 })
  const form = await request.formData()
  const budget = form.get("monthlyBudgetCredits")
  try {
    if (typeof budget === "string") {
      return await requestJson(
        new URL("/api/learnings/evaluation-budget", request.url),
        learningMutationResponseSchema,
        {
          method: "PATCH",
          body: JSON.stringify({ monthlyBudgetCredits: budget.trim() }),
          signal: request.signal,
        },
      )
    }
    return await requestJson(
      new URL(`/api/repositories/${id}/learnings/evaluations`, request.url),
      learningMutationResponseSchema,
      {
        method: "PATCH",
        body: JSON.stringify({
          enabled: readSwitch(form, "enabled"),
          screenshots: readSwitch(form, "screenshots"),
        }),
        signal: request.signal,
      },
    )
  } catch (error) {
    return canvasActionError(error)
  }
}

export function meta() {
  return [{ title: "Automated evaluations - Replica Hub" }]
}

function dateLabel(value: string) {
  return new Date(value).toLocaleDateString()
}

export default function LearningEvaluations({ loaderData, params }: Route.ComponentProps) {
  const fetcher = useFetcher<{ error?: string; notice?: string }>()
  const { pathname } = useLocation()
  const busy = fetcher.state !== "idle"
  const { screenshots } = loaderData
  function submit(form: FormData) {
    void fetcher.submit(form, { method: "post", action: pathname })
  }
  return (
    <FormBoundary
      busy={busy}
      error={busy ? null : fetcher.data?.error}
      notice={busy ? null : fetcher.data?.notice}
      onSubmit={submit}
    >
      <EvaluationSettingsPage
        busy={busy}
        data={{
          repositoryName: loaderData.repository.nameWithOwner,
          learningsPath: `/repositories/${params.repositoryId}/learnings`,
          budget: {
            limitCredits: loaderData.monthlyBudgetCredits,
            usedCredits: loaderData.usedCredits,
            editable: loaderData.permissions.changeBudget,
          },
          evaluations: {
            editable: loaderData.permissions.changeRepository,
            enabled: loaderData.enabled,
            screenshotsAllowed: screenshots.allowed,
            screenshotsRecord:
              screenshots.changedBy && screenshots.changedAt
                ? `${screenshots.allowed ? "Allowed" : "Turned off"} by @${screenshots.changedBy} on ${dateLabel(screenshots.changedAt)}`
                : null,
          },
        }}
        onChange={(change) => {
          const form = new FormData()
          for (const [name, value] of Object.entries(change)) form.set(name, String(value))
          submit(form)
        }}
      />
    </FormBoundary>
  )
}

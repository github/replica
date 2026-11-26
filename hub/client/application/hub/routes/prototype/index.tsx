import { useEffect, useState } from "react"
import { data, useFetcher, useOutletContext } from "react-router"

import { prototypeEditSchema } from "@application/hub/contracts"
import type {
  PrototypeActionResult,
  PrototypeResponse,
  WorkspaceResponse,
} from "@application/hub/contracts/types"
import { readRecordIdentifier } from "@application/hub/read-record-identifier"
import { ApiContractError } from "@application/hub/requests/api-contract-error"
import { ApiRequestError } from "@application/hub/requests/api-request-error"
import { getAppliedLearnings } from "@application/hub/requests/get-applied-learnings"
import { getPrototype } from "@application/hub/requests/get-prototype"
import type { AppliedLearningResponse } from "@application/hub/learnings-contracts/types"
import { updatePrototype } from "@application/hub/requests/update-prototype"
import { PrototypeScreen } from "@application/hub/screens/prototype-screen"

import type { Route } from "./+types/index"
import type { WorkspaceRouteHandle } from "../workspace/types"

export const handle = {
  workspaceSection: "prototypes",
  defaultNavigationCollapsed: true,
} satisfies WorkspaceRouteHandle

type ActionResponse = ReturnType<typeof data<PrototypeActionResult>>

export async function clientLoader({
  request,
  params,
}: Pick<Route.ClientLoaderArgs, "request" | "params">): Promise<PrototypeResponse> {
  return getPrototype(
    request,
    readRecordIdentifier(params.repositoryId, "repository"),
    readRecordIdentifier(params.prototypeId, "prototype"),
  )
}

/**
 * Reads what agents applied in the selected Build after the page shows. Learnings are
 * optional, so a slow or failed read never holds up or breaks the prototype page.
 */
function useAppliedLearnings(prototype: PrototypeResponse) {
  const repositoryId = prototype.repository.id
  const prototypeId = prototype.prototype.id
  const commitSha = prototype.selectedBuild?.commitSha?.toLowerCase()
  const key = `${repositoryId}/${prototypeId}/${commitSha}`
  const [loaded, setLoaded] = useState<{ key: string; learnings: AppliedLearningResponse[] }>()
  useEffect(() => {
    if (!commitSha) return
    const controller = new AbortController()
    getAppliedLearnings(
      new Request(window.location.href, { signal: controller.signal }),
      repositoryId,
      prototypeId,
      commitSha,
    ).then(
      (response) => setLoaded({ key, learnings: response.learnings }),
      () => undefined,
    )
    return () => controller.abort()
  }, [commitSha, key, prototypeId, repositoryId])
  // Learnings from a previously selected Build must not show beside this one.
  return loaded?.key === key ? loaded.learnings : []
}

export async function clientAction({
  request,
  params,
}: Pick<Route.ClientActionArgs, "request" | "params">): Promise<ActionResponse> {
  if (request.method.toUpperCase() !== "POST") {
    throw new Response("Method not allowed.", { status: 405, headers: { Allow: "POST" } })
  }
  const form = await request.formData()
  const description = form.get("description")
  const parsed = prototypeEditSchema.safeParse({
    name: form.get("name"),
    description,
    startPage: form.has("startPage") ? form.get("startPage") : undefined,
  })
  if (!parsed.success) {
    return data<PrototypeActionResult>(
      { saved: false, error: parsed.error.issues.map(({ message }) => message).join(" ") },
      { status: 422 },
    )
  }

  try {
    await updatePrototype(
      request,
      readRecordIdentifier(params.repositoryId, "repository"),
      readRecordIdentifier(params.prototypeId, "prototype"),
      parsed.data,
    )
    return data<PrototypeActionResult>({ saved: true })
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return data<PrototypeActionResult>(
        { saved: false, error: error.message },
        { status: error.status >= 400 && error.status <= 599 ? error.status : 503 },
      )
    }
    if (error instanceof ApiContractError) {
      return data<PrototypeActionResult>(
        {
          saved: false,
          error: "The API response was invalid, so the saved changes could not be confirmed.",
        },
        { status: 502 },
      )
    }
    throw error
  }
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: loaderData ? `${loaderData.prototype.name} - Replica Hub` : "Replica Hub" }]
}

export default function Prototype({ loaderData }: Pick<Route.ComponentProps, "loaderData">) {
  const workspace = useOutletContext<WorkspaceResponse>()
  // React Router retains fetcher data; keep save feedback scoped to this prototype.
  const fetcher = useFetcher<PrototypeActionResult>({
    key: `prototype-details:${loaderData.repository.id}/${loaderData.prototype.id}`,
  })
  const saving = fetcher.state !== "idle"
  const appliedLearnings = useAppliedLearnings(loaderData)
  return (
    <PrototypeScreen
      key={`${loaderData.repository.id}/${loaderData.prototype.id}`}
      workspace={workspace}
      data={loaderData}
      appliedLearnings={appliedLearnings}
      onSaveDetails={(details) => {
        void fetcher.submit(
          {
            name: details.name,
            description: details.description ?? "",
            startPage: details.startPage,
          },
          { method: "post" },
        )
      }}
      savingDetails={saving}
      detailsError={!saving && fetcher.data?.saved === false ? fetcher.data.error : null}
      detailsSaved={!saving && fetcher.data?.saved === true}
    />
  )
}

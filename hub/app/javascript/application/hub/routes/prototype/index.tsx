import { data, useFetcher, useOutletContext } from "react-router"

import type { Route } from "./+types/index"
import { prototypeDetailsSchema } from "../../contracts"
import type { PrototypeActionResult, PrototypeResponse, WorkspaceResponse } from "../../contracts"
import { readRouteIdentifier } from "../../read-route-identifier"
import { ApiContractError } from "../../requests/api-contract-error"
import { ApiRequestError } from "../../requests/api-request-error"
import { getPrototype } from "../../requests/get-prototype"
import { updatePrototype } from "../../requests/update-prototype"
import { PrototypeScreen } from "../../screens/prototype-screen"

type ActionResponse = ReturnType<typeof data<PrototypeActionResult>>

export async function clientLoader({
  request,
  params,
}: Pick<Route.ClientLoaderArgs, "request" | "params">): Promise<PrototypeResponse> {
  return getPrototype(
    request,
    readRouteIdentifier(params.repositoryId, "repository"),
    readRouteIdentifier(params.prototypeId, "prototype"),
  )
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
  const parsed = prototypeDetailsSchema.safeParse({
    name: form.get("name"),
    description: typeof description === "string" ? description.trim() || null : description,
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
      readRouteIdentifier(params.repositoryId, "repository"),
      readRouteIdentifier(params.prototypeId, "prototype"),
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

export default function PrototypeRoute({ loaderData }: Pick<Route.ComponentProps, "loaderData">) {
  const workspace = useOutletContext<WorkspaceResponse>()
  const fetcher = useFetcher<PrototypeActionResult>({
    key: `prototype-details:${loaderData.repository.id}/${loaderData.prototype.id}`,
  })
  const saving = fetcher.state !== "idle"
  return (
    <PrototypeScreen
      key={`${loaderData.repository.id}/${loaderData.prototype.id}`}
      workspace={workspace}
      data={loaderData}
      onSaveDetails={(details) => {
        void fetcher.submit(
          { name: details.name, description: details.description ?? "" },
          { method: "post" },
        )
      }}
      savingDetails={saving}
      detailsError={!saving && fetcher.data?.saved === false ? fetcher.data.error : null}
      detailsSaved={!saving && fetcher.data?.saved === true}
    />
  )
}

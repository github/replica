import { z } from "zod"

import { ApiRequestError } from "@application/hub/requests/api-request-error"

import { readFormField } from "../read-form-field"

function parseJson(value: string) {
  try {
    return JSON.parse(value) as unknown
  } catch {
    throw new ApiRequestError(
      422,
      "Enter valid JSON for the headers, body template, and response rule.",
    )
  }
}

export function readDestinationForm(request: Request, repositoryId: string, form: FormData) {
  const source = new URL(request.url)
  let action: URL
  try {
    action = new URL(readFormField(form, "_action"), source)
  } catch {
    throw new ApiRequestError(422, "Invalid analytics destination.")
  }
  if (
    action.origin !== source.origin ||
    action.pathname !== `/repositories/${repositoryId}/analytics`
  ) {
    throw new ApiRequestError(422, "Invalid analytics destination.")
  }
  const intent = readFormField(form, "_method") || "post"
  const operation = readFormField(form, "operation")
  const rawId = action.searchParams.get("destinationId")
  const id = rawId ? z.uuid().safeParse(rawId) : null
  if ((id && !id.success) || (intent !== "post" && !id?.success)) {
    throw new ApiRequestError(422, "Invalid analytics destination.")
  }
  const path = id?.success ? `/${id.data}` : ""
  if (intent === "delete" && !operation) return { method: "DELETE", path } as const
  if (intent === "patch" && (operation === "pause" || operation === "resume")) {
    return { method: "POST", path: `${path}/${operation}` } as const
  }
  if (operation || (intent !== "patch" && (intent !== "post" || id))) {
    throw new ApiRequestError(422, "Invalid analytics operation.")
  }
  const provider = readFormField(form, "destination[provider]")
  function field(name: string) {
    return readFormField(form, `destination[${name}]`)
  }
  function credential(name: string) {
    return field(`credentials][${name}`)
  }
  let configuration: unknown
  if (provider === "segment") {
    configuration = { region: field("region"), writeKey: credential("write_key") }
  } else if (provider === "mixpanel") {
    configuration = {
      region: field("region"),
      serviceAccountUsername: credential("service_account_username"),
      serviceAccountSecret: credential("service_account_secret"),
      projectId: credential("project_id"),
    }
  } else if (provider === "custom") {
    const secrets = []
    for (let index = 0; index < 8; index++) {
      const name = field(`secrets][${index}][name`)
      const value = field(`secrets][${index}][value`)
      if (name || value) secrets.push({ name, value })
    }
    const successPointer = field("success_pointer")
    configuration = {
      name: field("name"),
      endpoint: field("endpoint"),
      headers: parseJson(field("headers")),
      template: parseJson(field("template")),
      secrets,
      successPointer,
      ...(successPointer ? { successValue: parseJson(field("success_value")) } : {}),
      keepPending: field("keep_pending") === "1",
    }
  } else {
    throw new ApiRequestError(422, "Choose a destination provider.")
  }
  return {
    method: intent === "post" ? "POST" : "PATCH",
    path,
    body: {
      provider,
      configuration,
      eventTypes: form.getAll("destination[event_types][]").filter((value) => value !== ""),
      includeRetained: intent === "post" && field("history") === "retained",
    },
  } as const
}

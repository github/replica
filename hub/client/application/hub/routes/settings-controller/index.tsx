import { data, redirect } from "react-router"
import type { ClientActionFunctionArgs, ClientLoaderFunctionArgs } from "react-router"

import { routeIdentifierSchema } from "../../contracts"
import {
  settingsMutationResponseSchema,
  settingsPublicResponseSchema,
  settingsQuerySchema,
  settingsWorkspaceResponseSchema,
} from "../../settings-contracts"
import type { SettingsActionResult, SettingsSection } from "../../settings-contracts"
import { ApiContractError } from "../../requests/api-contract-error"
import { ApiRequestError } from "../../requests/api-request-error"
import { settingsRequest } from "../../requests/settings-request"
import { resourcePath } from "../../view-models/resource-path"
import { reportClientIssue } from "../../report-client-issue"
import { settingsFormOperation } from "../settings-form-operation"
import type { SettingsRouteData } from "./types"

export function settingsController(section: SettingsSection, surface: "workspace" | "public") {
  function settingsUrl(request: Request, params: ClientLoaderFunctionArgs["params"]) {
    const url = new URL(request.url)
    if (section !== "analytics" && section !== "learnings") return url
    const parsed = routeIdentifierSchema.safeParse(params.repositoryId)
    if (!parsed.success) throw new Response("Invalid repository identifier.", { status: 400 })
    url.searchParams.set("repositoryId", String(parsed.data))
    return url
  }

  async function clientLoader({
    request,
    params,
  }: ClientLoaderFunctionArgs): Promise<SettingsRouteData> {
    const url = settingsUrl(request, params)
    const parsed = settingsQuerySchema.safeParse(Object.fromEntries(url.searchParams))
    if (!parsed.success) throw new Response("Invalid settings filters.", { status: 400 })
    if (surface === "public") {
      const state = await settingsRequest(request, "public", settingsPublicResponseSchema)
      return { surface: "public", state, query: parsed.data }
    }
    const state = await settingsRequest(
      request,
      "workspace",
      settingsWorkspaceResponseSchema,
      undefined,
      url.searchParams,
    )
    if (
      (section === "analytics" || section === "learnings") &&
      state.repository?.id !== parsed.data.repositoryId
    ) {
      throw new Response("This repository is not available.", { status: 404 })
    }
    if (!state.repository && ["analytics", "learnings", "canvas-approval"].includes(section)) {
      throw new Response("Choose a repository before using this page.", {
        status: 404,
      })
    }
    if (section === "admin-confirmation") {
      if (
        !["1", "2"].includes(params.userId ?? "") ||
        (params.operation !== "designate" && params.operation !== "revoke")
      ) {
        throw new Response("This user or role-change operation does not exist.", {
          status: 404,
        })
      }
      return {
        surface: "workspace",
        state,
        query: parsed.data,
        confirmation: { userId: Number(params.userId), operation: params.operation },
      }
    }
    return { surface: "workspace", state, query: parsed.data }
  }

  async function clientAction({ request, params }: ClientActionFunctionArgs) {
    if (request.method.toUpperCase() !== "POST") {
      throw new Response("Method not allowed.", { status: 405, headers: { Allow: "POST" } })
    }
    try {
      const url = settingsUrl(request, params)
      const operation = settingsFormOperation(section, url, await request.formData(), params)
      const result = await settingsRequest(
        request,
        "actions",
        settingsMutationResponseSchema,
        operation,
        url.searchParams,
      )
      if (result.redirect) throw redirect(resourcePath(result.redirect, url.searchParams))
      return data<SettingsActionResult>({
        saved: true,
        notice: result.notice,
        revision: result.revision,
      })
    } catch (error) {
      if (error instanceof Response && error.status === 501) {
        reportClientIssue(await error.text())
        return data<SettingsActionResult>(
          { saved: false, error: "This action is unavailable. No changes were saved." },
          { status: 501 },
        )
      }
      if (error instanceof Response && error.status >= 400) {
        return data<SettingsActionResult>(
          { saved: false, error: await error.text() },
          { status: error.status },
        )
      }
      if (error instanceof ApiRequestError) {
        return data<SettingsActionResult>(
          { saved: false, error: error.message },
          { status: error.status >= 400 && error.status <= 599 ? error.status : 503 },
        )
      }
      if (error instanceof ApiContractError) {
        return data<SettingsActionResult>(
          {
            saved: false,
            error: "The API response was invalid. The change could not be confirmed.",
          },
          { status: 502 },
        )
      }
      throw error
    }
  }

  return { clientLoader, clientAction }
}

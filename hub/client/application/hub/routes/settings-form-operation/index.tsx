import { settingsOperationSchema } from "@application/hub/settings-contracts"
import type { SettingsOperation, SettingsSection } from "@application/hub/settings-contracts/types"

import { readFormField } from "../read-form-field"
import { readNumericFormField } from "../read-numeric-form-field"
import { requireFormDestination } from "../require-form-destination"

export function settingsFormOperation(
  section: SettingsSection,
  requestUrl: URL,
  form: FormData,
  params: Record<string, string | undefined>,
): SettingsOperation {
  for (const name of form.keys()) {
    if (/secret|credentials|private_key/.test(name)) {
      throw new Response("Credential submission is not connected yet. No request was sent.", {
        status: 501,
      })
    }
  }
  const declaredMethod = readFormField(form, "_formMethod")
  if (declaredMethod && declaredMethod !== "POST") {
    throw new Response("Only explicit POST forms are supported.", { status: 405 })
  }
  const source = new URL(readFormField(form, "_action") || requestUrl.href, requestUrl)
  if (source.origin !== requestUrl.origin) {
    throw new Response("External form destinations are not supported.", { status: 422 })
  }
  const method = readFormField(form, "_method") || "post"
  const confirmed = readFormField(form, "confirmed") === "1"
  const repositoryId = params.repositoryId ?? source.searchParams.get("repositoryId")
  let input: unknown

  switch (section) {
    case "welcome":
      requireFormDestination(source, method, "/welcome", ["patch"])
      input = { operation: "welcome-hide" }
      break
    case "analytics": {
      requireFormDestination(source, method, `/repositories/${params.repositoryId}/analytics`, [
        "post",
        "patch",
        "delete",
      ])
      const destinationId = source.searchParams.has("destinationId")
        ? Number(source.searchParams.get("destinationId"))
        : undefined
      const change = readFormField(form, "operation")
      if (method === "delete" || change === "pause" || change === "resume") {
        input = {
          operation: "analytics-state",
          repositoryId,
          destinationId,
          state: method === "delete" ? "disconnected" : change === "pause" ? "paused" : "enabled",
        }
      } else {
        if (change) throw new Response("Unknown analytics operation.", { status: 422 })
        const provider = readFormField(form, "destination[provider]")
        input = {
          operation: "analytics-save",
          repositoryId,
          destinationId,
          configuration: {
            provider,
            region: provider === "custom" ? "custom" : readFormField(form, "destination[region]"),
            name: readFormField(form, "destination[name]"),
            eventTypes: form.getAll("destination[event_types][]").filter((value) => value !== ""),
            history: readFormField(form, "destination[history]") || "new",
          },
        }
      }
      break
    }
    case "canvas-approval":
      requireFormDestination(source, method, "/settings/canvas/approve", ["post"])
      input = {
        operation: "canvas-approve",
        repositoryId,
        consentVersion: readFormField(form, "learnings_consent_version"),
      }
      break
    case "canvas":
      requireFormDestination(source, method, "/settings/canvas", ["delete"])
      input = { operation: "canvas-revoke", grantId: Number(source.searchParams.get("grantId")) }
      break
    case "copilot":
      requireFormDestination(source, method, "/settings/copilot", ["post", "delete"])
      input = {
        operation: method === "delete" ? "copilot-disconnect" : "copilot-connect",
        confirmed,
      }
      break
    case "github-setup":
      requireFormDestination(source, method, "/settings/github/setup", ["post"])
      input = { operation: "github-setup", organization: readFormField(form, "organization") }
      break
    case "github-register":
      requireFormDestination(source, method, "/settings/github/register", ["post"])
      input = { operation: "github-register" }
      break
    case "github-installed":
      requireFormDestination(source, method, "/settings/github/installed", ["post"])
      input = { operation: "github-install" }
      break
    case "github": {
      requireFormDestination(source, method, "/settings/github", ["post", "patch", "delete"])
      const expectedVersion = readNumericFormField(form, "expected_version")
      const change = source.searchParams.get("change")
      if (change === "credentials" && method === "patch") {
        input = { operation: "github-credentials", expectedVersion, confirmed }
      } else if (change === "rotation" && ["post", "delete"].includes(method)) {
        input = {
          operation: "github-rotation",
          expectedVersion,
          confirmed,
          phase: method === "delete" ? "finish" : readFormField(form, "operation"),
        }
      } else if (change === "reset" && method === "delete") {
        input = {
          operation: "github-reset",
          expectedVersion,
          confirmed,
          confirmation: readFormField(form, "confirmation"),
        }
      } else {
        throw new Response("Choose an App change.", { status: 422 })
      }
      break
    }
    case "admins":
      requireFormDestination(source, method, "/settings/admins", ["post"])
      input = {
        operation: "admin-add",
        userIds: form.getAll("user_ids[]").map((value) => Number(value)),
        confirmed,
      }
      break
    case "admin-confirmation":
      requireFormDestination(
        source,
        method,
        `/settings/admins/${params.userId ?? ""}/${params.operation ?? ""}`,
        ["patch"],
      )
      if (readFormField(form, "operation") !== params.operation) {
        throw new Response("The confirmation does not match this role-change route.", {
          status: 422,
        })
      }
      input = {
        operation: "admin-change",
        userId: Number(params.userId),
        change: params.operation,
        confirmed,
      }
      break
    case "enrollment":
      requireFormDestination(source, method, "/settings/enroll", ["post"])
      input = { operation: "enroll" }
      break
    case "authorize":
      requireFormDestination(source, method, "/settings/authorize", ["post", "delete"])
      input = {
        operation: method === "delete" ? "authorization-cancel" : "authorize",
        continuationId: readFormField(form, "authorization_continuation_id"),
      }
      break
    case "notifications":
      requireFormDestination(source, method, "/notifications", ["post"])
      if (!["true", "false"].includes(readFormField(form, "read"))) {
        throw new Response("Choose an explicit notification read state.", { status: 422 })
      }
      input = {
        operation: "notification-read",
        notificationId: readNumericFormField(form, "notificationId"),
        version: readNumericFormField(form, "version"),
        read: readFormField(form, "read") === "true",
      }
      break
    case "sessions":
      requireFormDestination(source, method, "/settings/sessions", ["post"])
      input =
        readFormField(form, "cancelled") === "1"
          ? { operation: "session-cancel" }
          : { operation: "session-revoke", confirmed }
      break
    case "audit":
      throw new Response("The security audit is read-only.", { status: 405 })
  }
  const parsed = settingsOperationSchema.safeParse(input)
  if (!parsed.success) {
    throw new Response(parsed.error.issues.map(({ message }) => message).join(" "), { status: 422 })
  }
  return parsed.data
}

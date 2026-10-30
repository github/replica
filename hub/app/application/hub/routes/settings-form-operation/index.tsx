import { settingsOperationSchema } from "../../settings-contracts"
import type { SettingsOperation, SettingsSection } from "../../settings-contracts"

export function settingsFormOperation(
  section: SettingsSection,
  requestUrl: URL,
  form: FormData,
  params: Record<string, string | undefined>,
): SettingsOperation {
  function field(name: string) {
    const value = form.get(name)
    if (value !== null && typeof value !== "string") {
      throw new Response("File uploads are not accepted by this mock flow.", { status: 422 })
    }
    return value ?? ""
  }

  for (const name of form.keys()) {
    if (/secret|credentials|private_key/.test(name)) {
      throw new Response("This simulation does not accept credentials.", { status: 422 })
    }
  }
  function numberField(name: string) {
    const value = field(name)
    if (!/^\d+$/.test(value)) {
      throw new Response(`A numeric ${name} is required.`, { status: 422 })
    }
    return Number(value)
  }
  const declaredMethod = field("_formMethod")
  if (declaredMethod && declaredMethod !== "POST") {
    throw new Response("Only explicit POST forms are supported.", { status: 405 })
  }
  const source = new URL(field("_action") || requestUrl.href, requestUrl)
  if (source.origin !== requestUrl.origin) {
    throw new Response("External form destinations are not supported.", { status: 422 })
  }
  const method = field("_method") || "post"
  const confirmed = field("confirmed") === "1"
  const repositoryId = Number(source.searchParams.get("repositoryId"))
  let input: unknown

  function requirePath(path: string, methods: string[]) {
    if (source.pathname !== path || !methods.includes(method)) {
      throw new Response("This form operation is not supported on this page.", { status: 422 })
    }
  }

  switch (section) {
    case "welcome":
      requirePath("/welcome", ["patch"])
      input = { operation: "welcome-hide" }
      break
    case "analytics": {
      requirePath("/settings/analytics", ["post", "patch", "delete"])
      const destinationId = source.searchParams.has("destinationId")
        ? Number(source.searchParams.get("destinationId"))
        : undefined
      const change = field("operation")
      if (method === "delete" || change === "pause" || change === "resume") {
        input = {
          operation: "analytics-state",
          repositoryId,
          destinationId,
          state: method === "delete" ? "disconnected" : change === "pause" ? "paused" : "enabled",
        }
      } else {
        if (change) throw new Response("Unknown analytics operation.", { status: 422 })
        const provider = field("destination[provider]")
        input = {
          operation: "analytics-save",
          repositoryId,
          destinationId,
          configuration: {
            provider,
            region: provider === "custom" ? "custom" : field("destination[region]"),
            name: field("destination[name]"),
            eventTypes: form.getAll("destination[event_types][]").filter((value) => value !== ""),
            history: field("destination[history]") || "new",
          },
        }
      }
      break
    }
    case "canvas-approval":
      requirePath("/settings/canvas/approve", ["post"])
      input = {
        operation: "canvas-approve",
        repositoryId,
        consentVersion: field("learnings_consent_version"),
      }
      break
    case "canvas":
      requirePath("/settings/canvas", ["delete"])
      input = { operation: "canvas-revoke", grantId: Number(source.searchParams.get("grantId")) }
      break
    case "copilot":
      requirePath("/settings/copilot", ["post", "delete"])
      input = {
        operation: method === "delete" ? "copilot-disconnect" : "copilot-connect",
        confirmed,
      }
      break
    case "github-setup":
      requirePath("/settings/github/setup", ["post"])
      input = { operation: "github-setup", organization: field("organization") }
      break
    case "github-register":
      requirePath("/settings/github/register", ["post"])
      if (field("manifest") !== '{"name":"Replica Hub mock","mock":true}') {
        throw new Response("Only the synthetic App manifest is accepted.", { status: 422 })
      }
      input = { operation: "github-register" }
      break
    case "github-installed":
      requirePath("/settings/github/installed", ["post"])
      input = { operation: "github-install" }
      break
    case "github": {
      requirePath("/settings/github", ["post", "patch", "delete"])
      const expectedVersion = numberField("expected_version")
      const change = source.searchParams.get("change")
      if (change === "credentials" && method === "patch") {
        input = { operation: "github-credentials", expectedVersion, confirmed }
      } else if (change === "rotation" && ["post", "delete"].includes(method)) {
        input = {
          operation: "github-rotation",
          expectedVersion,
          confirmed,
          phase: method === "delete" ? "finish" : field("operation"),
        }
      } else if (change === "reset" && method === "delete") {
        input = {
          operation: "github-reset",
          expectedVersion,
          confirmed,
          confirmation: field("confirmation"),
        }
      } else {
        throw new Response("Choose an explicit simulated App change.", { status: 422 })
      }
      break
    }
    case "admins":
      requirePath("/settings/admins", ["post"])
      input = {
        operation: "admin-add",
        userIds: form.getAll("user_ids[]").map((value) => Number(value)),
        confirmed,
      }
      break
    case "admin-confirmation":
      requirePath(`/settings/admins/${params.userId ?? ""}/${params.operation ?? ""}`, ["patch"])
      if (field("operation") !== params.operation) {
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
      requirePath("/settings/enroll", ["post"])
      input = { operation: "enroll" }
      break
    case "authorize":
      requirePath("/settings/authorize", ["post", "delete"])
      input = {
        operation: method === "delete" ? "authorization-cancel" : "authorize",
        continuationId: field("authorization_continuation_id"),
      }
      break
    case "learnings": {
      requirePath("/settings/learnings", ["post"])
      const operation = source.searchParams.get("operation")
      input =
        operation === "run" || operation === "advance"
          ? {
              operation: operation === "run" ? "learning-run" : "learning-advance",
              repositoryId,
            }
          : {
              operation: "learning-decide",
              repositoryId,
              learningId: source.searchParams.get("learningId"),
              decision: field("decision"),
              digest: field("digest") || undefined,
              content: form.has("content") ? field("content") : undefined,
              reason: form.has("reason") ? field("reason") : undefined,
            }
      if (operation && operation !== "run" && operation !== "advance") {
        throw new Response("Unknown learning operation.", { status: 422 })
      }
      break
    }
    case "notifications":
      requirePath("/notifications", ["post"])
      if (!["true", "false"].includes(field("read"))) {
        throw new Response("Choose an explicit notification read state.", { status: 422 })
      }
      input = {
        operation: "notification-read",
        notificationId: numberField("notificationId"),
        version: numberField("version"),
        read: field("read") === "true",
      }
      break
    case "sessions":
      requirePath("/settings/sessions", ["post"])
      input =
        field("cancelled") === "1"
          ? { operation: "session-cancel" }
          : { operation: "session-revoke", confirmed }
      break
    case "audit":
      throw new Response("The mock audit is read-only.", { status: 405 })
  }
  const parsed = settingsOperationSchema.safeParse(input)
  if (!parsed.success) {
    throw new Response(parsed.error.issues.map(({ message }) => message).join(" "), { status: 422 })
  }
  return parsed.data
}

import type { PrismaClient } from "../../../generated/prisma/client.ts"
import { createGitHubActionsClient } from "../../../integrations/github/create-github-actions-client/index.ts"
import { createGitHubWebhookDeliveriesClient } from "../../../integrations/github/create-github-webhook-deliveries-client/index.ts"
import type {
  GitHubWebhookDeliveriesClientInput,
  GitHubWebhookDeliveriesClientOptions,
} from "../../../integrations/github/create-github-webhook-deliveries-client/types.ts"
import { GitHubWebhookRequestError } from "../../../integrations/github/create-github-webhook-deliveries-client/errors.ts"
import { testGitHubAppConnection } from "../../../integrations/github/test-github-app-connection/index.ts"
import { findGitHubWebhookEvidence } from "../../../repositories/github-webhook-deliveries/find-github-webhook-evidence/index.ts"

/** Observes provider settings and receipts without sending or redelivering an event. */
export async function checkGitHubWebhookCommunication(
  input: {
    credentials: GitHubWebhookDeliveriesClientInput & { installationId: string }
    applicationOrigin: string
    githubRepositoryId: number
    runId: number
    deliveryGuid?: string
    database?: PrismaClient
  },
  options: GitHubWebhookDeliveriesClientOptions = {},
) {
  const { credentials } = input
  const client = createGitHubWebhookDeliveriesClient(credentials, options)
  const checks: { name: string; result: "pass" | "fail" | "unknown"; detail: string }[] =
    await testGitHubAppConnection(credentials, options)
  async function check(name: string, operation: () => Promise<boolean>) {
    try {
      const passed = await operation()
      checks.push({
        name,
        result: passed ? "pass" : "fail",
        detail: passed ? "Verified." : "The observed value does not match Hub's requirements.",
      })
    } catch (error) {
      checks.push({
        name,
        result: "fail",
        detail:
          error instanceof GitHubWebhookRequestError
            ? error.message
            : "The provider check failed. Check App permissions, installation access, and connectivity.",
      })
    }
  }
  await check("webhook_configuration", async () => {
    const configuration = await client.getConfiguration()
    return (
      configuration.url === new URL("/api/github/webhooks", input.applicationOrigin).href &&
      configuration.contentType === "json" &&
      configuration.insecureSsl === "0"
    )
  })
  await check("webhook_events", async () => {
    const events = await client.getSubscribedEvents()
    return ["workflow_run", "workflow_job", "push", "delete"].every((event) =>
      events.includes(event),
    )
  })
  await check("repository_workflow_access", async () => {
    const actions = createGitHubActionsClient(
      { ...credentials, githubRepositoryId: input.githubRepositoryId },
      options,
    )
    const run = await actions.getWorkflowRun(input.runId)
    if (!run || run.repositoryId !== input.githubRepositoryId) return false
    await actions.getCommitAuthor(run.headSha)
    return true
  })
  let observed = false
  await check("delivery_history", async () => {
    const page = await client.listDeliveries(null)
    observed = page.deliveries.some(
      (delivery) =>
        delivery.guid === input.deliveryGuid &&
        String(delivery.installationId) === credentials.installationId &&
        delivery.repositoryId === input.githubRepositoryId,
    )
    return true
  })
  if (!input.deliveryGuid || !observed || !input.database) {
    checks.push({
      name: "signed_receipt_and_processing",
      result: "unknown",
      detail:
        "No correlated database check ran. Supply a delivery GUID from this repository's latest 100 deliveries and an existing database connection. GitHub HTTP success alone does not prove signed processing.",
    })
  } else {
    const evidence = await findGitHubWebhookEvidence(input.database, {
      deliveryGuid: input.deliveryGuid,
      githubRepositoryId: input.githubRepositoryId,
      runId: input.runId,
    })
    checks.push({
      name: "signed_receipt",
      result: evidence.receipt ? "pass" : "fail",
      detail: evidence.receipt
        ? "Hub recorded this delivery after signature verification and event handling."
        : "Hub has no recorded receipt for this delivery.",
    })
    checks.push({
      name: "workflow_processing",
      result:
        evidence.build?.state === "failed"
          ? "fail"
          : evidence.build?.workflowCompletedAt && evidence.build.state === "successful"
            ? "pass"
            : "unknown",
      detail: evidence.build
        ? `Build state: ${evidence.build.state}; completed import pass: ${Boolean(evidence.build.workflowCompletedAt)}. Polling may also have processed this run.`
        : "No Build was observed for this repository and run.",
    })
    checks.push({
      name: "webhook_recovery",
      result:
        evidence.redelivery?.state === "succeeded"
          ? "pass"
          : evidence.redelivery?.state === "failed"
            ? "fail"
            : "unknown",
      detail: evidence.redelivery
        ? `Recorded recovery state: ${evidence.redelivery.state}; attempts: ${evidence.redelivery.attempts}.`
        : "No recovery attempt is recorded for this delivery; recovery was not exercised.",
    })
  }
  return checks
}

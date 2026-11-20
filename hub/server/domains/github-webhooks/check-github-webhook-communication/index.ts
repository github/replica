import type { PrismaClient } from "../../../generated/prisma/client.ts"
import { createGitHubActionsClient } from "../../../integrations/github/create-github-actions-client/index.ts"
import { createGitHubWebhookDeliveriesClient } from "../../../integrations/github/create-github-webhook-deliveries-client/index.ts"
import type {
  GitHubWebhookDeliveriesClientInput,
  GitHubWebhookDeliveriesClientOptions,
} from "../../../integrations/github/create-github-webhook-deliveries-client/types.ts"
import { GitHubWebhookRequestError } from "../../../integrations/github/create-github-webhook-deliveries-client/errors.ts"
import { GitHubCommitLookupError } from "../../../integrations/github/errors.ts"
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
          error instanceof GitHubWebhookRequestError || error instanceof GitHubCommitLookupError
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
  let historyRead = false
  let observed: { event: string } | undefined
  await check("delivery_history", async () => {
    const page = await client.listDeliveries(null)
    historyRead = true
    observed = page.deliveries.find(
      (delivery) =>
        delivery.guid === input.deliveryGuid &&
        String(delivery.installationId) === credentials.installationId &&
        delivery.repositoryId === input.githubRepositoryId,
    )
    return true
  })
  if (!input.deliveryGuid || !observed || !input.database) {
    const reason = !input.deliveryGuid
      ? "No delivery GUID was supplied."
      : !historyRead
        ? "Delivery history could not be read."
        : !observed
          ? "The GUID was not found for this installation and repository in the latest 100 deliveries."
          : "No existing database connection was supplied."
    checks.push({
      name: "signed_receipt",
      result: "unknown",
      detail: `${reason} A signed receipt was not checked.`,
    })
    checks.push({
      name: "run_build_import",
      result: "unknown",
      detail: `${reason} The repository and run Build was not checked.`,
    })
    checks.push({
      name: "delivery_to_run",
      result: "unknown",
      detail: "No evidence associates the delivery with the supplied workflow run.",
    })
    checks.push({
      name: "webhook_recovery",
      result: "unknown",
      detail: `${reason} Recovery evidence was not checked.`,
    })
  } else {
    const evidence = await findGitHubWebhookEvidence(input.database, {
      deliveryGuid: input.deliveryGuid,
      githubRepositoryId: input.githubRepositoryId,
      runId: input.runId,
    })
    checks.push({
      name: "signed_receipt",
      result: evidence.receipt?.event === observed.event ? "pass" : "fail",
      detail: evidence.receipt
        ? evidence.receipt.event === observed.event
          ? "Hub recorded this delivery after signature verification and event handling."
          : "Hub's recorded event does not match this provider delivery."
        : "Hub has no recorded receipt for this delivery.",
    })
    checks.push({
      name: "run_build_import",
      result:
        evidence.build?.state === "failed"
          ? "fail"
          : evidence.build?.workflowCompletedAt && evidence.build.state === "successful"
            ? "pass"
            : "unknown",
      detail: evidence.build
        ? `Independent run Build state: ${evidence.build.state}; completed import pass: ${Boolean(evidence.build.workflowCompletedAt)}. Polling may also have processed this run.`
        : "No Build was observed for this repository and run.",
    })
    checks.push({
      name: "delivery_to_run",
      result: "unknown",
      detail:
        "The receipt and Build observations do not establish that this delivery caused this run's import.",
    })
    checks.push({
      name: "webhook_recovery",
      result: evidence.redelivery?.state === "failed" ? "fail" : "unknown",
      detail: evidence.redelivery
        ? `Recorded recovery state: ${evidence.redelivery.state}; attempts: ${evidence.redelivery.attempts}. A succeeded state may be settled from an existing receipt or provider delivery without redelivery.`
        : "No recovery attempt is recorded for this delivery; recovery was not exercised.",
    })
  }
  return checks
}

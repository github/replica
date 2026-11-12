import { administratorAuthorizationStartInputSchema } from "@application/hub/administrator-contracts"
import { navigateToExternalUrl } from "@application/hub/navigate-to-external-url"
import { ApiRequestError } from "@application/hub/requests/api-request-error"
import { startAdministratorAuthorization } from "@application/hub/requests/start-administrator-authorization"

export async function beginAdministratorAuthorization(request: Request, form: FormData) {
  const input = administratorAuthorizationStartInputSchema.safeParse({
    operation: form.get("operation"),
    targetMembershipIds: form.getAll("targetMembershipIds"),
  })
  if (!input.success) {
    throw new ApiRequestError(400, "The administrator selection is invalid.")
  }
  const started = await startAdministratorAuthorization(request, input.data)
  navigateToExternalUrl(started.authorizationUrl)
}

import type { Prisma } from "../../../generated/prisma/client.ts"
import { lockSelectedAuthenticationProvider } from "../../../repositories/authentication-providers/lock-selected-authentication-provider/index.ts"

export async function requireCurrentGitHubInstallation(
  transaction: Prisma.TransactionClient,
  expected: { configurationDigest: string; revision: number },
): Promise<void> {
  const provider = await lockSelectedAuthenticationProvider(transaction, "github")
  if (!provider?.enabled || !provider.selectedRevisionId) {
    throw new Error("The GitHub installation is not the selected authentication configuration.")
  }
  const revision = await transaction.authenticationProviderRevision.findUnique({
    select: { configurationDigest: true, revision: true },
    where: { id: provider.selectedRevisionId },
  })
  if (
    !revision ||
    revision.revision !== expected.revision ||
    revision.configurationDigest !== expected.configurationDigest
  ) {
    throw new Error("The GitHub installation is not the selected authentication configuration.")
  }
}

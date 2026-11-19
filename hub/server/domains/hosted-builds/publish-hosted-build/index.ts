import {
  finishHostedImport,
  type HostedImportClaim,
  type RetainedHostedArtifact,
} from "../../../repositories/hosted-builds/retain-hosted-import/index.ts"
import {
  withHostedBuildRepository,
  type HostedBuildAuthority,
} from "../with-hosted-build-repository/index.ts"

/** The successful Build and every retained artifact become visible together. */
export async function publishHostedBuild(
  authority: HostedBuildAuthority,
  claim: HostedImportClaim,
  artifactId: bigint,
  artifacts: RetainedHostedArtifact[],
) {
  return withHostedBuildRepository(authority, async (transaction) => {
    if (!(await finishHostedImport(transaction, claim, artifactId, artifacts))) return false
    // Publication observers belong here, in the same transaction:
    // { repositoryId: authority.repository.id, prototypeId: claim.prototypeId, buildId: claim.id }
    return true
  })
}

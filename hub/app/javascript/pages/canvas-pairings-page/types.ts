type SharedData = {
  pageTitle: string
  productName: string
  heading: string
  description: string
  authenticityToken: string
}

export type CanvasPairingsPageData =
  | (SharedData & {
      kind: "approval"
      code: string
      codeLabel: string
      codeInstruction: string
      repository: string
      repositoryLabel: string
      permissions: string
      learningsConsentVersion?: string
      branch?: string
      branchLabel?: string
      approvalDeadline?: string
      cancelMethod?: "delete"
      expiration: string
      connectionsLabel: string
      connectionsPath: string
      approveLabel: string
      approvePath: string
      cancelLabel: string
      cancelPath: string
    })
  | (SharedData & {
      kind: "connections"
      emptyLabel: string
      backLabel: string
      backPath: string
      revokeLabel: string
      notice: string | null
      grants: {
        id: number
        repository: string
        branch?: string
        expiresLabel: string
        revokePath: string
      }[]
    })

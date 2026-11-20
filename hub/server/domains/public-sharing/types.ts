export type ShareLinkExpiration = "one_day" | "seven_days" | "thirty_days"

export type GitHubRepositoryPermission = "none" | "read" | "triage" | "write" | "maintain" | "admin"

export interface HostedSharingTarget {
  repositoryId: string
  prototypeId: string
}

export interface HostedSharingViewer {
  userId: string
  sessionProvider: string | null
  externalIdentityId?: string | null
}

export interface HostedSharingApproval extends HostedSharingTarget {
  userId: string
  identity: { id: string; issuer: string; subject: string }
  permission: Exclude<GitHubRepositoryPermission, "none">
  policyRevision: number
  repositoryAccessRevision: number
}

export interface PublicSharingService {
  applicationOrigin: string
  previewBaseOrigin: string
  maximumDays: 1 | 7 | 30
  hosted?: {
    authorize(
      input: HostedSharingTarget & {
        viewer: HostedSharingViewer
        getRepositoryPermission(): Promise<GitHubRepositoryPermission>
      },
    ): Promise<HostedSharingApproval>
  }
  getSettings(): Promise<{
    enabled: boolean
    revision: number
    activeLinkCount: number
  }>
  changeSettings(operation: "enable" | "disable"): Promise<{
    enabled: boolean
    revision: number
  }>
  listLinks(
    prototypeId: string,
    approval?: HostedSharingApproval,
  ): Promise<
    Array<{
      id: string
      publicId: string
      prototypeId: string
      buildId: string
      buildNumber: number
      label: string
      createdByLogin: string
      createdAt: Date
      expiresAt: Date
      revokedAt: Date | null
    }>
  >
  createLink(input: {
    repositoryId: string
    prototypeId: string
    buildNumber: number
    createdById: string
    createdByLogin: string
    label: string
    expiration: ShareLinkExpiration
    actorMembershipId?: string
    approval?: HostedSharingApproval
  }): Promise<{
    id: string
    publicId: string
    prototypeId: string
    buildId: string
    buildNumber: number
    label: string
    createdByLogin: string
    createdAt: Date
    expiresAt: Date
    revokedAt: Date | null
  }>
  revokeLink(input: {
    repositoryId: string
    prototypeId: string
    publicId: string
    actorMembershipId?: string
    approval?: HostedSharingApproval
  }): Promise<boolean>
  readPublicLink(publicId: string): Promise<
    | {
        state: "active"
        id: string
        buildId: string
        buildNumber: number
        expiresAt: Date
        label: string
        prototypeName: string
        startPage: string
      }
    | { state: "disabled" | "expired" | "revoked" | "unavailable" }
    | null
  >
  readAvailableLink(
    shareLinkId: string,
    buildId: string,
  ): Promise<{ expiresAt: Date; startPage: string; hosted?: true } | null>
}

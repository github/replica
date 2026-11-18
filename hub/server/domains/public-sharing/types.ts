export type ShareLinkExpiration = "one_day" | "seven_days" | "thirty_days"

export interface PublicSharingService {
  applicationOrigin: string
  previewBaseOrigin: string
  maximumDays: 1 | 7 | 30
  getSettings(): Promise<{
    enabled: boolean
    revision: number
    activeLinkCount: number
  }>
  changeSettings(operation: "enable" | "disable"): Promise<{
    enabled: boolean
    revision: number
  }>
  listLinks(prototypeId: string): Promise<
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
  ): Promise<{ expiresAt: Date; startPage: string } | null>
}

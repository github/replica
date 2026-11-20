export interface PrototypeViewer {
  externalIdentityId?: string | null
  membershipId: string
  sessionProvider: string | null
  role: "MEMBER" | "ADMINISTRATOR"
  userId: string
}

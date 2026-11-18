export interface PrototypeViewer {
  membershipId: string
  sessionProvider: string | null
  role: "MEMBER" | "ADMINISTRATOR"
  userId: string
}

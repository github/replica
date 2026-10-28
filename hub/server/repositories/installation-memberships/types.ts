export interface InstallationMembershipInput {
  userId: string
  status: "active" | "suspended"
  role: "member" | "administrator"
  source: "bootstrap" | "manual" | "synchronized"
}

export interface InstallationMembershipRecord {
  id: string
  userId: string
  status: string
  role: string
  source: string
}

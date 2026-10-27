export interface HubUser {
  id: string
  displayName: string | null
  avatarUrl: string | null
}

export type UserInput = Omit<HubUser, "id">

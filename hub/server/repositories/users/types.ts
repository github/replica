export interface HubUser {
  id: string
  provider: string
  providerId: string
  login: string
  name: string | null
  avatarUrl: string | null
  administrator: boolean
}

export type GitHubUserInput = Pick<HubUser, "providerId" | "login" | "name" | "avatarUrl">

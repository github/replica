export interface CopilotConnectionRouteDependencies {
  applicationOrigin: string
  connect: (input: { sessionDigest: string }) => Promise<unknown>
  disconnect: (input: { sessionDigest: string }) => Promise<unknown>
  findSession: (sessionDigest: string) => Promise<{ membershipId: string } | null>
  status: () => Promise<{
    configured: boolean
    connected: boolean
    connectedBy: {
      login: string | null
      membershipId: string
      name: string | null
    } | null
    refusedAt: Date | null
    verifiedAt: Date | null
  }>
}

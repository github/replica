export interface GitHubAuthenticationConfiguration {
  appOrigin: string
  clientSecret: string
  encryptionKey: Buffer
  publicConfiguration: {
    authorizationEndpoint: string
    callbackUri: string
    clientId: string
    tokenEndpoint: string
    userEndpoint: string
  }
  revision: number
  secureCookies: boolean
}

export interface TestDatabaseContext {
  adminUrl: string
  prefix: string
  workers: number
}

declare module "vitest" {
  interface ProvidedContext {
    testDatabase: TestDatabaseContext
  }
}

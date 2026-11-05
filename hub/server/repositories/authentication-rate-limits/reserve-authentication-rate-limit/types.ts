export interface AuthenticationRateLimitDatabase {
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>
  $queryRaw<Result>(query: TemplateStringsArray, ...values: unknown[]): Promise<Result>
}

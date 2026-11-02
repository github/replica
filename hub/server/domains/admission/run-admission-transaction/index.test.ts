import { expect, expectTypeOf, it } from "vitest"

import type { AdmissionDatabaseClient, AdmissionRepositories } from "./types"
import { runAdmissionTransaction } from "."

it("exposes only the database and operation parameters", () => {
  expect(runAdmissionTransaction).toHaveLength(2)
  expectTypeOf<Parameters<typeof runAdmissionTransaction>["length"]>().toEqualTypeOf<2>()

  const database = {} as AdmissionDatabaseClient
  function operation(repositories: AdmissionRepositories): Promise<string> {
    void repositories
    return Promise.resolve("result")
  }
  const parameters: Parameters<typeof runAdmissionTransaction> = [database, operation]
  expect(parameters).toHaveLength(2)
})

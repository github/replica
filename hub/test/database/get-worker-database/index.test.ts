import { describe, expect, it } from "vitest"

import { getWorkerDatabase } from "."

describe("getWorkerDatabase()", () => {
  it.each(["postgres:", "postgresql:"])(
    "changes only the database path for a %s connection",
    (protocol) => {
      const adminUrl = `${protocol}//test_user:example@localhost:5433/hub_development?sslmode=require&application_name=hub-tests&options=-c%20statement_timeout%3D5000`
      const database = { adminUrl, prefix: "replica_test_0123456789abcdef", workers: 4 }

      const result = new URL(getWorkerDatabase(database, "4"))
      const expected = new URL(adminUrl)
      expected.pathname = "/replica_test_0123456789abcdef_4"

      expect(result.href).toBe(expected.href)
    },
  )

  it("gives the first worker its own database rather than the admin database", () => {
    const database = {
      adminUrl: "postgresql://localhost/hub_development",
      prefix: "replica_test_fedcba9876543210",
      workers: 1,
    }

    expect(new URL(getWorkerDatabase(database, "1")).pathname).toBe(
      "/replica_test_fedcba9876543210_1",
    )
  })

  it.each([undefined, "", "0", "-1", "1.5", "1e0", "01", " 1", "1 ", "2", "NaN"])(
    "rejects invalid worker ID %s instead of selecting another database",
    (poolId) => {
      const database = {
        adminUrl: "postgresql://localhost/hub_development",
        prefix: "replica_test_0123456789abcdef",
        workers: 1,
      }

      expect(() => getWorkerDatabase(database, poolId)).toThrow()
    },
  )

  it.each([
    "hub_development",
    "replica_test_0123456789abcde",
    "replica_test_0123456789abcdef0",
    "replica_test_0123456789abcdeg",
    "replica_test_0123456789ABCDEF",
    "replica_test_0123456789abcdef_1",
    "replica_test_0123456789abcdef/other",
  ])("rejects unsafe database prefix %s", (prefix) => {
    const database = { adminUrl: "postgresql://localhost/hub_development", prefix, workers: 1 }

    expect(() => getWorkerDatabase(database, "1")).toThrow()
  })

  it.each(["not a URL", "https://localhost/hub_development", "file:///hub_development"])(
    "rejects a non-PostgreSQL admin URL %s",
    (adminUrl) => {
      const database = { adminUrl, prefix: "replica_test_0123456789abcdef", workers: 1 }

      expect(() => getWorkerDatabase(database, "1")).toThrow()
    },
  )
})

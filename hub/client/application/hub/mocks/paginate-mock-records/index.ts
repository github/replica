import type { Pagination } from "@application/hub/contracts/types"

import { MockStoreError } from "../store-error"

export function paginateMockRecords<T>(
  records: T[],
  page: number,
  pageSize: number,
): { records: T[]; pagination: Pagination } {
  const pageCount = Math.max(1, Math.ceil(records.length / pageSize))
  if (!Number.isInteger(page) || page < 1 || page > pageCount) {
    throw new MockStoreError(404, "Page not found.")
  }
  return {
    records: records.slice((page - 1) * pageSize, page * pageSize),
    pagination: { page, pageSize, totalCount: records.length, pageCount },
  }
}

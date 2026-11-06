import type { createMockStore } from "."

export interface Options {
  origin: string
  seed?: unknown
}

export type MockStore = ReturnType<typeof createMockStore>

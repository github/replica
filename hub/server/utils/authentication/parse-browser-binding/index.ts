import { z } from "zod"

const browserBindingSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/)

export function parseBrowserBinding(value: string | null): string | null {
  const parsed = browserBindingSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

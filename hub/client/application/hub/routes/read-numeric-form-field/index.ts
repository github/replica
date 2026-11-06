import { readFormField } from "../read-form-field"

export function readNumericFormField(form: FormData, name: string) {
  const value = readFormField(form, name)
  if (!/^\d+$/.test(value)) {
    throw new Response(`A numeric ${name} is required.`, { status: 422 })
  }
  return Number(value)
}

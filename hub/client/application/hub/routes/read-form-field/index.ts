export function readFormField(form: FormData, name: string) {
  const value = form.get(name)
  if (value !== null && typeof value !== "string") {
    throw new Response("File submission is not connected yet. No request was sent.", {
      status: 501,
    })
  }
  return value ?? ""
}

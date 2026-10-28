export function readCookie(header: string | undefined, name: string): string {
  const values = (header ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`))
  const value = values.length === 1 ? (values[0]?.slice(name.length + 1) ?? "") : ""
  return /^[\w-]{43}$/.test(value) ? value : ""
}

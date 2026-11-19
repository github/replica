export function canWriteRepository(permission: string): boolean {
  return permission === "write" || permission === "maintain" || permission === "admin"
}

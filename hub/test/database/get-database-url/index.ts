export function getDatabaseUrl() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("The database test harness must provide DATABASE_URL.")
  return url
}

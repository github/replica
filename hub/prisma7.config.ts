import "dotenv/config"
import { defineConfig } from "prisma/config"

export default defineConfig({
  schema: "schema",
  migrations: { path: "schema/migrations" },
  datasource: { url: process.env.DATABASE_URL },
})

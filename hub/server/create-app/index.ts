import express from "express"

export function createApp() {
  const app = express()
  app.disable("x-powered-by")

  app.get("/api/health", (_request, response) => {
    response.json({ status: "ok" })
  })

  app.use((_request, response) => {
    response.status(404).json({ error: "Not found" })
  })

  return app
}

export function serverConnectionFixtureResponse(
  scenario: string,
  path: string,
): Response | Promise<Response> {
  if (path === "/api/servers") {
    if (scenario === "scanning") return new Promise<Response>(() => {})
    if (scenario === "scan-failed")
      return Response.json(
        { error: "Could not check for servers. Check that lsof is installed." },
        { status: 503 },
      )
    const servers = ["single", "multiple", "connecting", "connect-failed", "warnings"].includes(
      scenario,
    )
      ? [{ url: "http://127.0.0.1:5173/", command: "node vite", pid: 1200 }]
      : []
    if (scenario === "multiple")
      servers.push({ url: "http://127.0.0.1:4173/", command: "node vite preview", pid: 1201 })
    return Response.json({
      servers,
      warnings:
        scenario === "warnings"
          ? ["http://127.0.0.1:4173/ did not return an HTML page (HTTP 503)."]
          : [],
      development: {
        scripts: ["empty", "scripts", "starting", "start-failed", "single", "multiple"].includes(
          scenario,
        )
          ? [
              { id: "dev", invocation: "npm run dev" },
              ...(scenario === "scripts" ? [{ id: "start", invocation: "npm start" }] : []),
            ]
          : [],
        message:
          scenario === "startup-unavailable"
            ? "Dev server startup is unavailable. Start the server manually or connect to a running server."
            : "Starting runs this checkout's dev script. Only start code you trust.",
      },
    })
  }
  if (path === "/api/server/start" || path === "/api/server/connect") {
    if (scenario.endsWith("-failed"))
      return Response.json(
        {
          error: path.endsWith("start")
            ? "Could not start the dev server. Check its output and try again."
            : "Could not connect. Make sure the server is still running, then try again.",
        },
        { status: 503 },
      )
    return new Promise<Response>(() => {})
  }
  if (path === "/api/server/status")
    return Response.json({
      startup: { output: "Vite is starting...\nWaiting for the local server." },
    })
  throw new Error(`Unexpected fixture request: ${path}`)
}

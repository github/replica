export function installFixture(scenario: string) {
  let starting = false
  window.fetch = async (input) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
      "http://localhost",
    )
    if (url.pathname === "/status") {
      if (scenario === "status-failed")
        return Response.json({ error: "The connection status is unavailable." }, { status: 503 })
      return Response.json({
        prototypeUrl: null,
        startup: {
          starting,
          message: "Starting npm run dev...",
          output:
            starting || scenario === "start-failed"
              ? "> welcome-prototype dev\n> vite --host 0.0.0.0\n\nStarting development server..."
              : "",
        },
      })
    }
    if (url.pathname === "/servers") {
      if (scenario === "scanning") return new Promise(() => {})
      if (scenario === "scan-failed")
        return Response.json(
          {
            error:
              "Could not scan for running servers. Check that lsof is installed, then scan again.",
          },
          { status: 503 },
        )
      const servers = ["single", "multiple", "connecting", "connect-failed", "warnings"].includes(
        scenario,
      )
        ? [{ url: "http://127.0.0.1:5173/", command: "vite", pid: 4321 }]
        : []
      if (scenario === "multiple")
        servers.push({ url: "http://127.0.0.1:4321/", command: "astro", pid: 4322 })
      const scripts = ["script", "scripts", "starting", "start-failed"].includes(scenario)
        ? [{ id: "dev", invocation: "npm run dev" }]
        : []
      if (scenario === "scripts") scripts.push({ id: "preview", invocation: "npm run preview" })
      return Response.json({
        servers,
        warnings:
          scenario === "warnings"
            ? ["http://127.0.0.1:4321/ did not return an HTML page (HTTP 503)."]
            : [],
        development: {
          scripts,
          message:
            scenario === "startup-unavailable"
              ? "Dev scripts could not be read. Start the server manually, then scan again."
              : scripts.length
                ? "Starting a script executes repository code, including any pre/post hooks."
                : "No supported development script was found. Start the server manually.",
        },
      })
    }
    if (url.pathname === "/connect") {
      if (scenario === "connecting") return new Promise(() => {})
      return Response.json(
        { error: "Could not connect to that server. Make sure it is running, then scan again." },
        { status: 503 },
      )
    }
    if (url.pathname === "/start") {
      if (scenario === "starting") {
        starting = true
        return new Promise(() => {})
      }
      return Response.json(
        { error: "Could not start the dev server. Scan again, then retry or start it manually." },
        { status: 503 },
      )
    }
    throw new Error(`Unexpected server-connection fixture request: ${url.pathname}`)
  }
}

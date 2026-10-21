---
name: start-app
description: 'Start the CoreAI Sandbox dev server and open it using available browser tools. USE WHEN: the user asks you to "start the app", "run the dev server", "open the app", or "launch CoreAI Sandbox".'
---

# Start the App

Run the app startup and then open the app using the available browser tools. Use terminal commands and process-management tools appropriate to the current operating system.

Read `apps/prototype/README.md` for any setup or configuration instructions before starting the app.

First, check whether the app is already available at `http://127.0.0.1:5174/`. Reuse the running server when it is healthy. Vite binds to `127.0.0.1` on strict port `5174`; do not assume a different port.

If startup fails because dependencies are missing, run `npm install` from the repository root. For persistent setup errors, follow the [CoreAI Prototype local setup guide](../../../README.md#run-locally) and report the actual error.

If no server is running, start `npm run prototype` from the repository root (or `npm --workspace apps/prototype run dev`) using the available terminal tool's background execution. Background execution is appropriate because the development server must remain active while work continues. Keep the returned process or session identifier so the server can be stopped later. If the user needs the server left running after the response, use supported persistent background execution when permitted; session-attached background servers can keep the chat active. Stop assistant-owned session-attached validation servers before finishing, and never stop a user-owned server without permission. If persistent background execution is unavailable, explain the limitation instead of promising a persistent server.

Do not poll the terminal or add artificial delays. Use the initial execution output or an automatic notification, when provided, to identify readiness or errors, and verify that the app responds at its URL. Use the available terminal tools with the returned identifier when background output is needed or the server must be stopped. Target the specific process or session, not all processes with the same executable name. A persistent server need not exit to be ready.

Once the server is ready, discover the available browser tools to open, inspect, and interact with `http://127.0.0.1:5174/`; use targeted browser scripting when the other browser tools are insufficient. If the first navigation occurs while Vite is still compiling and renders blank, confirm the server is responsive and reload once.

If browser tools are unavailable, give the user the URL instead of restarting the workflow. Leave a user-owned or permitted persistent background development server running; apply the assistant-owned session-attached-server cleanup rule above.

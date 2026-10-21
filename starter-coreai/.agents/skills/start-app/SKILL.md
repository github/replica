---
name: start-app
description: 'Start the CoreAI Sandbox dev server and open it using available browser tools. USE WHEN: the user asks you to "start the app", "run the dev server", "open the app", or "launch CoreAI Sandbox".'
---

# Start the App

Run the app startup and then open the app using the available browser tools. Use terminal commands and process-management tools appropriate to the current operating system.

Read the [local setup guide](../../../README.md#run-locally) before starting the app. Run commands from this app's directory.

Complete the [Replica canvas preflight](../../../REPLICA.md#canvas-preflight) before preview startup. Use the running app's URL in the Replica canvas for the visual preview and the [browser workflow](../browser-canvas-validation/WORKFLOW.md) for separate rendered checks.

First, check whether CoreAI Sandbox is already running at `http://127.0.0.1:5174/`. Verify the page belongs to this app before reusing the server. Vite defaults to strict port `5174`; if another app occupies it, leave that server untouched and use `npm run dev -- --port <available-port>`. Use the URL printed by the server.

If startup fails because dependencies are missing, run `npm ci` from this app's directory. Report persistent setup errors.

If no CoreAI server is running, start `npm run dev` using the available terminal tool's background execution. Keep the returned process or session identifier so the server can be stopped later. If the user needs the server left running after the response, use supported persistent background execution when permitted. Stop assistant-owned session-attached validation servers before finishing, and never stop a user-owned server without permission. If persistent background execution is unavailable, explain the limitation instead of promising a persistent server.

Do not poll the terminal or add artificial delays. Use the initial execution output or an automatic notification, when provided, to identify readiness or errors, and verify that the app responds at its URL. Use the available terminal tools with the returned identifier when background output is needed or the server must be stopped. Target the specific process or session, not all processes with the same executable name. A persistent server need not exit to be ready.

Once the server is ready, discover the available browser tools to open, inspect, and interact with its printed URL. If the first navigation occurs while Vite is still compiling and renders blank, confirm the server is responsive and reload once.

If browser tools are unavailable, give the user the URL instead of restarting the workflow. Leave a user-owned or permitted persistent background development server running; apply the assistant-owned session-attached-server cleanup rule above.

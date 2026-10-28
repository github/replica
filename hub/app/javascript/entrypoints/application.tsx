import "@/tokens/base.css"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { AuthenticationApplication } from "@/application/authentication"
import { HubThemeProvider } from "@hooks/use-hub-theme"

const root = document.getElementById("root")
if (!root) throw new Error("The Hub document is missing its React root.")

createRoot(root).render(
  <StrictMode>
    <HubThemeProvider>
      <AuthenticationApplication />
    </HubThemeProvider>
  </StrictMode>,
)

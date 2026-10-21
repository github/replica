import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { RouterProvider } from "@tanstack/react-router"

import { router } from "@app/router"

const container = document.getElementById("root")

if (!container) {
  throw new Error("Expected a #root element.")
}

createRoot(container).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)

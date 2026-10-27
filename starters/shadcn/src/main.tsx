import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import App from "./app"
import "./index.css"

const root = document.getElementById("root")

if (!root) {
  throw new Error("The app needs an element with id=\"root\".")
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

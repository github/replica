import { Link } from "@tanstack/react-router"

import { HomePage } from "../home-page"

export function HomeRoutePage() {
  return <HomePage aboutLink={<Link to="/about">Go to the about page</Link>} />
}

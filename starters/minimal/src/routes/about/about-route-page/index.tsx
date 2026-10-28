import { Link } from "@tanstack/react-router"

import { AboutPage } from "../about-page"

export function AboutRoutePage() {
  return <AboutPage homeLink={<Link to="/">Back to start page</Link>} />
}

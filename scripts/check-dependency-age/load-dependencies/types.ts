export interface Dependency {
  ecosystem: "npm" | "github-actions"
  name: string
  version: string
  source: string
}

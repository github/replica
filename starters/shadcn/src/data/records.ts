export type WorkspaceRecord = {
  id: string
  title: string
  category: string
  owner: string
  status: "In progress" | "In review" | "Complete"
  updated: string
  description: string
}

export const records: WorkspaceRecord[] = [
  {
    id: "REC-001",
    title: "Website redesign",
    category: "Design",
    owner: "Alex Morgan",
    status: "In progress",
    updated: "2026-10-24",
    description:
      "Refresh the public website with clearer navigation and a more useful product overview. The next step is reviewing the first homepage prototype.",
  },
  {
    id: "REC-002",
    title: "Customer research",
    category: "Research",
    owner: "Sam Rivera",
    status: "In review",
    updated: "2026-10-23",
    description:
      "Bring together sample interview notes and identify opportunities to improve the onboarding experience.",
  },
  {
    id: "REC-003",
    title: "Mobile app onboarding",
    category: "Product",
    owner: "Taylor Chen",
    status: "In progress",
    updated: "2026-10-22",
    description:
      "Explore a shorter welcome flow that helps new users complete their first task without a guided tour.",
  },
  {
    id: "REC-004",
    title: "Design system refresh",
    category: "Design",
    owner: "Alex Morgan",
    status: "Complete",
    updated: "2026-10-21",
    description:
      "Document shared component patterns and accessibility decisions for the next round of prototypes.",
  },
  {
    id: "REC-005",
    title: "Product launch checklist",
    category: "Operations",
    owner: "Jordan Lee",
    status: "In review",
    updated: "2026-10-20",
    description:
      "Check the sample launch assets, support notes and release announcement before sharing the prototype.",
  },
  {
    id: "REC-006",
    title: "Quarterly roadmap",
    category: "Planning",
    owner: "Sam Rivera",
    status: "Complete",
    updated: "2026-10-19",
    description:
      "Collect the team's example priorities in a single view. These records are fictional and do not represent a committed plan.",
  },
]

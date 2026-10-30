export type SampleMessage = {
  role: "author" | "copilot"
  body: string
  pending?: boolean
}

export type SampleThread = {
  id: number
  body: string
  target: string
  path: string
  samplePoint: { xPercent: number; yPercent: number }
  status: "open" | "ready" | "resolved"
  originalPending?: boolean
  messages: SampleMessage[]
}

export const sampleThreads: SampleThread[] = [
  {
    id: 1,
    body: "Make the primary action more prominent and shorten the label to 'New project'.",
    target: "New project button",
    path: "/projects",
    samplePoint: { xPercent: 22, yPercent: 18 },
    status: "ready",
    messages: [
      {
        role: "copilot",
        body: "I shortened the label to 'New project' and increased the contrast of the primary action.\nThe secondary actions retain their quieter styling.",
      },
    ],
  },
  {
    id: 2,
    body: "Give the two project cards more breathing room and align their metadata.",
    target: "Selected region",
    path: "/projects",
    samplePoint: { xPercent: 68, yPercent: 42 },
    status: "ready",
    messages: [
      {
        role: "copilot",
        body: "I increased the spacing between cards and aligned their metadata.",
      },
      { role: "author", body: "Keep that spacing, but make the card titles a little stronger." },
      {
        role: "copilot",
        body: "The card titles now use a stronger weight without changing the spacing.",
      },
      { role: "author", body: "Please also align the action menus with the titles." },
      { role: "copilot", body: "The action menus are now aligned with the title row." },
    ],
  },
  {
    id: 3,
    body: "Explain what notifications this switch controls before asking me to enable it.",
    target: "Notifications settings",
    path: "/settings",
    samplePoint: { xPercent: 36, yPercent: 72 },
    status: "open",
    originalPending: true,
    messages: [],
  },
]

/** The permissions and webhook events Hub's GitHub App needs. */
export const githubAppRequirements = {
  permissions: [
    { key: "actions", label: "Actions", access: "read" },
    { key: "contents", label: "Contents", access: "write" },
    { key: "pull_requests", label: "Pull requests", access: "write" },
  ],
  organizationPermissions: [{ key: "members", label: "Members", access: "read" }],
  events: [
    { key: "push", label: "Push" },
    { key: "delete", label: "Branch or tag deletion" },
    { key: "workflow_run", label: "Workflow run" },
    { key: "workflow_job", label: "Workflow job" },
    { key: "installation_target", label: "Installation target" },
    { key: "repository", label: "Repository" },
    { key: "member", label: "Member" },
    { key: "membership", label: "Membership" },
    { key: "organization", label: "Organization" },
    { key: "team", label: "Team" },
  ],
} as const
